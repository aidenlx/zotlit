# Coding standards

Review-only policy index for apps/obsidian. Load these during standards review. Apply the root standards too; local exceptions have the scope stated below. Keep implementation context in `AGENTS.md`.

Record each meaningful agent mistake in the relevant policy on its first occurrence, through `/retro`
or a direct edit. State the expected behavior and what the reviewer must check.

## Policies

- [CLI text](policies/cli-text.md)
- [Events](policies/events.md)
- [File operations](policies/file-ops.md)
- [Hover popovers](policies/hover-popover.md)
- [Keyboard scope](policies/keyboard-scope.md)
- [Local storage](policies/local-storage.md)
- [Pop-out windows](policies/popout-windows.md)
- [Services](policies/services.md)
- [Unload](policies/unload.md)
- [Tailwind-first](policies/tailwind-first.md)
- [Theme hooks](policies/theme-hooks.md)
- [Tooltips](policies/tooltips.md)
- [UI seams](policies/ui-seams.md)

## UI roots

Mark each plugin UI root (`ItemView.contentEl`, modal `contentEl`, settings pane) with `class="zt-root"` — that scope enables the Tailwind preflight so semantic HTML and border utilities render clean. See the skill's **Scoped preflight** section.

## Effect

Review Effect code against the docs of the installed `effect` package, the version the code runs: `node_modules/effect/AGENTS.md`, and the topic folders of `node_modules/effect/ai-docs/src/` — `01_effect` (basics, Schema, services, errors, resources, running), `03_stream`, `04_integration/10_managed-runtime.ts`, `08_observability`, `09_testing`. Cite the doc for each finding. A departure from a documented pattern carries a comment that names its reason.

The `effecttsgo/*` rules (`@effect/tsgo`, configured in `packages/config/oxlint.base.ts`) check the mechanical Effect patterns, at the level of the `recommended` preset:

- **Gate (error):** `class-self-mismatch`, `effect-fn-implicit-any`, `floating-effect`, `floating-effect-in-vitest`, `missing-effect-context`, `missing-effect-error`, `missing-layer-context`, `missing-return-yield-star`, `missing-star-in-yield-effect-gen`, `overridden-schema-constructor`, `schema-literal-non-finite`, `schema-opaque-instance-member`. The opt-in rules are also errors: `global-date`, `global-date-in-effect`, `global-fetch-in-effect`, `global-timers-in-effect`, `process-env-in-effect`, and in this app `global-console`, `global-console-in-effect`.
- **Warn:** every other preset rule (`effect-fn-opportunity`, `lazy-effect`, `schema-number`, `unknown-in-effect-catch` and the rewrite hints). A warning does not fail the lint, but it is not left in the code: the change that adds one fixes it. `any-unknown-in-error-context` is off: `unknown` is the correct error at a Promise seam and in generic helpers that accept any Effect, and the tsgo default is also off.
- **Not checked:** the rules do not see where a failure is handled, whether a step must be uninterruptible, how a layer releases what it acquires, or whether a test proves the behavior. Review these by hand (the list below).

`zotlit-effect-tests/typed-fake` (`scripts/oxlint-plugin-effect-tests.ts`) reports a test fake behind a cast. Review what it cannot see: a fake carries only the members its test reads, and a fake that several tests share is one double in its service's `__fixtures__.ts` (root `policies/testing-strategy.md` → Service fakes).

`zotlit-effect-style/no-tacit` (`scripts/oxlint-plugin-effect-style.ts`) reports a function passed by name to an Effect combinator, such as `Effect.map(fn)`, and `flow`: write the lambda `(x) => fn(x)` (Effect v4 code style → Avoid Tacit Usage).

Check in particular:

- **Service methods** return Effects, and callers outside Effect go through the plugin runtime's `bridge` ([Services](policies/services.md) → Bridge); a view's plain code goes through its view runner ([Services](policies/services.md) → Views). Every service method with arguments is traced `Effect.fn("<Tag>.<method>")` (`01_effect/01_basics/02_effect-fn.ts`, `01_effect/03_services/01_service.ts`), a generator or a body that returns an Effect; `effecttsgo/effect-fn-opportunity` reports a method that is not. A member with no arguments is an `Effect` value, not a method (`readonly refresh: Effect.Effect<…>`), traced with `Effect.withSpan("<Tag>.<member>")`: `Effect.gen(function* () {…}).pipe(Effect.withSpan(…))`, or the Effect itself when it is already lazy (`Effect.sync(…)`, `Ref.get(ref)`). It runs again on each `yield*`, as an `Effect.fn` body does; a body that reads mutable state while it builds the Effect goes in `Effect.suspend`. `effecttsgo/lazy-effect` reports a zero-argument method. A method on a per-frame or per-message hot path (per worker message, per stream chunk, per item in a loop that runs many times) is `Effect.fnUntraced` instead, with a comment that names the path. The rule is off in tests and fixtures (`*.test.*`, `*.bench.ts`, `*.browser-test.ts`, `__fixtures__`): a test double of a method stays a plain function, and a double of a zero-argument member is an Effect value (`Effect.suspend(spy)` when a test counts its runs). `Effect.fn` runs its body when the Effect runs, not when the method is called, so work that must happen at call time stays outside the body.
- **Crossing in** from plain code runs through the plugin's `ManagedRuntime` (`buildRuntime` in `src/lib/effect-layer.ts`); a view crosses in through its view runner (`lib/view-runner.ts`). An Obsidian event enters a layer from the source's capability tag (`changes`, narrowed with `filterTag` and handled with `forkEach`); a capability tag registers it through `obsidianEventSource`, and an event from a source with no tag yet enters through `obsidianEvents` ([Events](policies/events.md)); any other Obsidian callback registered there runs through a runner made from the layer's own context (`Effect.runSyncWith(yield* Effect.context<never>())`), so it keeps the layer's services and Clock.
- **Failures** are typed in the error channel as `Schema.TaggedError`s and handled where a decision is made, by tag (`catchTag`). A member's failure type is the real failure type of the core it runs, without the failures that `recover` or the core already removes; `orDie` is for a failure that cannot happen, with a comment that says why. A boundary that must not fail catches the whole `Cause` (`catchCause`) and logs it. A boundary that lets interrupts pass and maps other failures to a fallback uses `recover` (`lib/effect-cause.ts`); a boundary that reports an outcome uses `reportOutcome` (`lib/notifier.ts`). Unknown persisted data decodes through `Schema` (`decodeUnknownOption` to degrade).
- **Time** and dates: lint holds the date rule (`zotlit-services/temporal-in-effect`, `clock-time`, `dateGlobals` in `packages/config/oxlint.base.ts`). Review what it cannot see: `@zotlit/db` rows keep `Temporal.Instant`, the template contract, and Effect code passes them on as is; an Effect value reaches plain code as `Temporal` through `src/lib/effect-clock.ts` (`toInstant` in `views/note-preview/render.ts`). Plain code that only measures an instant against its own clock reads it by `epochMilliseconds`, which `Temporal.Instant` and `DateTime.Utc` both carry (`CopyInstant` in `annotation-repository/capability-copy.ts`), so Effect and plain callers share it without a conversion. A plain file that imports `effect-clock` counts as Effect code.
- **Cancellation**: an API that returns an Effect cancels by interruption and takes no `AbortSignal`. Where a native or Promise API inside it needs a signal, `Effect.tryPromise((signal) => …)` or `Effect.abortSignal` (aborted when its Scope closes) gives it one. A plain caller that holds a signal — a modal's cancel, the plugin's unload, a CLI run — turns it into an interrupt at the edge with `runPromiseExit(effect, { signal })` and rejects with `signal.reason` where the signal ended the run. A test cancels by interrupting the fiber (`Fiber.interrupt`, or `interruptUnsafe` from inside the run) and expects an interrupt exit; a test of a plain API models the signal's holder with a plain helper. A modal that an Effect waits on opens through `awaitModal` (`lib/effect-modal.ts`) or `awaitConfirm` (`lib/confirm.ts`), so an interrupt closes it. `effecttsgo/abort-controller-in-effect` reports a controller made inside Effect code.
- **Interruption**: a step that must finish once started — applying a configuration, a write with its own cleanup — is `Effect.uninterruptible`, and its test proves a scope close waits for it.

## Logging

Log through Effect, with the category set by `withLogCategory` from `@/lib/effect-log` (under parent `["zotlit", "obsidian"]`) and fields as annotations. `effecttsgo/global-console` and `effecttsgo/global-console-in-effect` report a `console` call, and `zotlit-logging/no-logtape-in-effect-file` reports a LogTape logger in a file that imports Effect:

```ts
Effect.logWarning("Could not read the saved Uses; starting empty").pipe(
  Effect.annotateLogs({ error }),
  withLogCategory("use-ledger"),
);
```

`getLogger` from `@/lib/log` is the legacy LogTape logger, for files that have no Effect in them yet. A type-only import of `EffectBridge` does not count: a legacy file that holds the bridge keeps LogTape until it converts (`policies/services.md` → Bridge).

`layerLogging` in `src/services/log/service.ts` owns LogTape's configuration; the dev-only `enableStartupLogging` is the one other caller. The ZoteroReads worker logs through Effect and posts each record over a port (`lib/effect-log-port.ts`); the host re-emits it into the renderer's Effect logger at the plugin's log level. The citation-parse worker has no logger.

## View state and menus

View/modal state uses a zustand **vanilla store + React context, one per instance** — not the global `create()` hook, not signals. Follow `src/views/annot-view/store.ts`.

Menus and popovers are Obsidian's own `Menu` and popover primitives, built imperatively and shown from the gesture that opens them — inside a Preact tree as much as in vanilla DOM. `src/views/annot-view` is the pattern: `presentation.ts` answers which entries exist, `menus.ts` fills a `Menu` from them, `actions.tsx` shows it, and the component calls the action; `pane-menu.ts` puts the same entries in the pane menu. A menu opened from a control is anchored under it with `showMenuAtButton` from `src/lib/menu.ts`, which keeps a keyboard-activated control and a popout host both correct; `showAtMouseEvent` is for a right-click. Obsidian owns placement, viewport clamping, theme, and chrome ([ADR 0044](docs/adr/0044-menus-and-popovers-are-obsidians-own-primitives.md)). A menu opened from inside a Chooser — the "…" of a Chooser page — is `Chooser.PageMenu`, a popover nested in the popup, since a `Menu` paints under the popup's top layer.

A control that opens a popup — a `Select`, a Chooser, a popover of its own — meets every item of [Keyboard and focus](docs/bases-toolbar-menu.md#keyboard-and-focus).

## Chooser page fields

A field on a `Chooser.Page` keeps its typed text with `useChooserPageText` and saves through `useChooserPageSave`, plus its own blur and Enter handlers (both hooks live in `src/components/chooser.tsx`). A page unmounts with no blur event, and an input followed by a key in the same task reads stale state; the save reads the `typed` ref from `useChooserPageText`, not the rendered `text`.
