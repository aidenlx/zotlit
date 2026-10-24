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
- [Tailwind-first](policies/tailwind-first.md)
- [Theme hooks](policies/theme-hooks.md)
- [Tooltips](policies/tooltips.md)
- [UI seams](policies/ui-seams.md)

## UI roots

Mark each plugin UI root (`ItemView.contentEl`, modal `contentEl`, settings pane) with `class="zt-root"` — that scope enables the Tailwind preflight so semantic HTML and border utilities render clean. See the skill's **Scoped preflight** section.

## Effect

Review Effect code against the docs of the installed `effect` package, the version the code runs: `node_modules/effect/AGENTS.md`, and the topic folders of `node_modules/effect/ai-docs/src/` — `01_effect` (basics, Schema, services, errors, resources, running), `03_stream`, `04_integration/10_managed-runtime.ts`, `08_observability`, `09_testing`. Cite the doc for each finding. A departure from a documented pattern carries a comment that names its reason. The `effecttsgo/*` rules (`@effect/tsgo`, enabled in `packages/config/oxlint.base.ts`) cover the mechanical Effect patterns; review the rest.

Check in particular:

- **Service methods** return Effects, and callers outside Effect go through the service's plain adapter ([Services](policies/services.md) → Plain adapter). A method written as a generator is `Effect.fn("<Tag>.<method>")` (`01_effect/01_basics/02_effect-fn.ts`, `01_effect/03_services/01_service.ts`); a read derived from state (`Effect.map` over a `SubscriptionRef`) or a single combinator call (`Effect.acquireUseRelease`) stays a plain expression.
- **Crossing in** from plain code runs through the plugin's `ManagedRuntime` (`buildRuntime` in `src/lib/effect-layer.ts`). An Obsidian event registered inside a layer enters through `obsidianEvents` ([Events](policies/events.md)); any other Obsidian callback registered there runs through a runner made from the layer's own context (`Effect.runSyncWith(yield* Effect.context<never>())`), so it keeps the layer's services and Clock.
- **Failures** are typed in the error channel and handled where a decision is made; a boundary that must not fail catches the whole `Cause` (`catchCause`) and logs it. Unknown persisted data decodes through `Schema` (`decodeUnknownOption` to degrade).
- **Time** comes from `Clock` (`instantClock` for a `Temporal.Instant`), so `TestClock` drives it.
- **Interruption**: a step that must finish once started — applying a configuration, a write with its own cleanup — is `Effect.uninterruptible`, and its test proves a scope close waits for it.

## Logging

Log through Effect, with the category set by `withLogCategory` from `@/lib/effect-log` (under parent `["zotlit", "obsidian"]`) and fields as annotations:

```ts
Effect.logWarning("Could not read the saved Uses; starting empty").pipe(
  Effect.annotateLogs({ error }),
  withLogCategory("use-ledger"),
);
```

`getLogger` from `@/lib/log` is the legacy LogTape logger, for files that have no Effect in them yet.

`layerLogging` in `src/services/log/service.ts` owns LogTape's configuration; the dev-only `enableStartupLogging` is the one other caller. The ZoteroReads worker logs through Effect and posts each record over a port (`lib/effect-log-port.ts`); the host re-emits it into the renderer's Effect logger at the plugin's log level. The citation-parse worker has no logger.

## View state and menus

View/modal state uses a zustand **vanilla store + React context, one per instance** — not the global `create()` hook, not signals. Follow `src/views/annot-view/store.ts`.

Menus and popovers are Obsidian's own `Menu` and popover primitives, built imperatively and shown from the gesture that opens them — inside a Preact tree as much as in vanilla DOM. `src/views/annot-view` is the pattern: `presentation.ts` answers which entries exist, `menus.ts` fills a `Menu` from them, `actions.tsx` shows it, and the component calls the action; `pane-menu.ts` puts the same entries in the pane menu. A menu opened from a control is anchored under it with `showMenuAtButton` from `src/lib/menu.ts`, which keeps a keyboard-activated control and a popout host both correct; `showAtMouseEvent` is for a right-click. Obsidian owns placement, viewport clamping, theme, and chrome ([ADR 0044](docs/adr/0044-menus-and-popovers-are-obsidians-own-primitives.md)). A menu opened from inside a Chooser — the "…" of a Chooser page — is `Chooser.PageMenu`, a popover nested in the popup, since a `Menu` paints under the popup's top layer.

A control that opens a popup — a `Select`, a Chooser, a popover of its own — meets every item of [Keyboard and focus](docs/bases-toolbar-menu.md#keyboard-and-focus).

## Chooser page fields

A field on a `Chooser.Page` keeps its typed text with `useChooserPageText` and saves through `useChooserPageSave`, plus its own blur and Enter handlers (both hooks live in `src/components/chooser.tsx`). A page unmounts with no blur event, and an input followed by a key in the same task reads stale state; the save reads the `typed` ref from `useChooserPageText`, not the rendered `text`.
