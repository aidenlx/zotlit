---
name: obsidian-services
description: |
  Service architecture for the Obsidian plugin: Effect services, the plugin runtime that composes them, and the plugin shell. Use when
  creating, modifying, or wiring services in apps/obsidian/src/services/ or editing zt-main.ts lifecycle code.
---

# Service Architecture

Every plugin service is an Effect service (see **Effect services**).

Use the source as the canonical reference. Do not copy service/runtime/plugin-shell snippets out of this skill; read the current implementation before editing so examples cannot drift from real code.

## Canonical Files

- `apps/obsidian/src/services/plugin-layer.ts`: `pluginLayer`, the Effect graph and its build order.
- `apps/obsidian/src/services/plugin-runtime.ts`: `createPluginRuntime` — builds the runtime over `pluginLayer` on the caller's stack, awaits acquisition, then binds the edge handles, the runtime's `bridge` and the CLI runner, and returns them as one plain object.
- `apps/obsidian/src/lib/effect-layer.ts` and `effect-scope.ts`: where a runtime or Scope meets an `AsyncDisposableStack`.
- `apps/obsidian/src/zt-main.ts`: plugin lifecycle ownership, `await using`, `stack.move()`, cleanup, and debug service access.
- `apps/obsidian/src/lib/disposables.ts`: `Disposable` helpers for `stack.use(...)`.

## Workflow

1. Open `apps/obsidian/src/services/plugin-layer.ts` for the Effect graph and `apps/obsidian/src/services/plugin-runtime.ts` for how `createPluginRuntime` builds it and binds what the plugin shell reads. Treat these as authoritative.
2. Open `apps/obsidian/src/zt-main.ts` before changing plugin load/unload behavior. Keep it a thin lifecycle shell.
3. For a new service, create `apps/obsidian/src/services/<service-name>/service.ts` as an Effect service (see **Effect services**) and add its layer to `pluginLayer`. When the plugin shell or a view calls it, read the tag once in `createPluginRuntime` (`runtime.runSync(Tag)`) and add it to the returned object; that code calls it through the runtime's `bridge`.
4. Pass `plugin`, `plugin.app`, and the values a registration needs explicitly through deps objects. Avoid module-global service lookups.
5. Use `apps/obsidian/src/lib/disposables.ts` helpers when adapting Obsidian or DOM registrations into `Disposable` values for `stack.use(...)`.
6. Run the Obsidian package typecheck after edits.

## Effect services

New services are Effect services: a `Context.Service` tag and a scoped `Layer`, composed in `pluginLayer`. `createPluginRuntime` builds that graph as a `ManagedRuntime` from `buildRuntime` (`@/lib/effect-layer`), whose disposal sits under everything the plugin shell puts on the stack, so the graph closes after the last shell registration. Settings and logging build below every other layer, so a service logs from its first line. `UseLedger` (`apps/obsidian/src/services/use-ledger/`) is the converted example; its `__fixtures__.ts` builds its layer over a fake App for tests.

- Import Effect from `effect`; the `effectEntry` Vite plugin (`apps/obsidian/scripts/effect-entry.ts`) resolves it to `src/lib/effect.ts`. Its run entry points carry the browser scheduler and the logger, and no graph service.
- The tag shape is Effect-native: each method with arguments is `Effect.fn("<Tag>.<method>")`, a generator or a body that returns an `Effect` (`Effect.fnUntraced` on a per-message or per-item hot path; a test double stays a plain function). A member with no arguments is a `readonly` `Effect` value traced with `Effect.withSpan("<Tag>.<member>")`, and callers write `yield* service.refresh`, not `service.refresh()` (`effecttsgo/lazy-effect` reports a zero-argument method); its test double is an Effect value too. Events are Streams and state:
  - What others watch is a `SubscriptionRef`, exposed as `SubscriptionRef.changes(ref)`: it replays the current value and ends when the layer's finalizer runs `PubSub.shutdown(ref.pubsub)`. A stream that ends on a terminal state adds `Stream.takeUntil`.
  - A discrete occurrence is a `PubSub` exposed as a Stream.
  - A condition a late subscriber must still see (stopped, failed, finished) is state.
- Export the layer beside the tag as `layer<Name>` (a function when it takes plain inputs).
- The plugin shell and edge handles hold the tag's service and the runtime's `bridge` (`EffectBridge`, `@/lib/effect-bridge`). `createPluginRuntime` reads the service once (`release: runtime.runSync(Release)`); consumers type their deps as `Pick<Release["Service"], …>` beside `Pick<EffectBridge, …>` and run each call through the bridge: `runSync`, `runPromise`, `runPromiseExit` (interrupted at unload, for a caller with its own closed answer), `subscribe(stream, callback)`. A fire-and-forget `void bridge.runPromise(…)` runs an Effect that cannot fail.
- A state machine with concurrency of its own is Effect code in its layer, not a class: the Zotero Local API session (`zotero-local-api/session.ts`, `makeLocalApiSession`) keeps its state in `Ref`s, shares one request in flight between its callers through a slot, as the Capability Probe does, queues work per key with a `Semaphore`, forks background work on the layer's Scope so that closing the Scope interrupts and awaits it, bounds a request with `Effect.timeoutOrElse`, reads time from the `Clock`, and cancels by interruption. A large state machine that coordinates none of that is Effect functions over one state record that its layer builds: the Annotation Repository core (`annotation-repository/core/`) takes the `CoreState` as its first parameter, `yield*`s the services the record holds (`ZoteroLocalApi["Service"]`, `ZoteroReads["Service"]`, `QueryClients["Service"]`), and publishes its events through a callback the layer turns into Streams. The layer's members `yield*` the core functions. Callbacks that a library calls (TanStack Query read and mutation functions) and the `Disposable` that `hold` answers are its edges, and run through `scopedBridge`, the bridge over the layer's own Scope.
- A layer reads the events of an Obsidian source that has a capability tag from the tag: `forkEach(filterTag(metadata.changes, "changed"), …)` for `MetadataCache` (`@/lib/obsidian-metadata-cache`). A capability tag registers its listeners through `obsidianEventSource` (`@/lib/obsidian-event-source`); the pattern is in `apps/obsidian/policies/events.md` → Capability tags. A layer registers events from a source with no tag yet (`vault`, `workspace`, and one-shots such as `onLayoutReady`) through `obsidianEvents` (`@/lib/effect-obsidian-events`). Any other Obsidian callback a layer registers runs its Effect through a runner made from the layer's context: `const run = Effect.runSyncWith(yield* Effect.context<never>())`. It keeps the layer's services and Clock, which the bare entry points lack.
- Obsidian's `App` is the `ObsidianApp` tag (`@/lib/obsidian-app`). Time is the Effect `Clock`, and dates in Effect code are `DateTime`; `@/lib/effect-clock` converts them to the `Temporal.Instant` of plain code (`toInstant`, `fromInstant`, `instantClock`).
- Resources live on the layer's Scope: `Effect.acquireRelease`, `Effect.addFinalizer`, and `acquireDisposable` / `acquireAsyncDisposable` for a value from outside Effect (root `policies/resource-disposal.md` → Effect code).
- Put a side effect behind a tag of its own when a test must replace it. `LogOutput` is the pattern: `layerLogging` drives LogTape through it, and its test supplies a fake whose work takes `TestClock` time.
- An Effect service has no `ready`: the layer has finished building before anyone holds it.
- `createPluginRuntime` awaits the layer graph (`runtime.context()`) before it reads any service, so a service anyone holds has finished acquiring. A layer's acquisition waits for exactly what its first answer needs, and no more. A wait on outside I/O (the Zotero database, a worker) is bounded with `startupBarrier` (`@/lib/effect-startup`), which keeps the read running on the Scope past the bound. Acquisition settles and never fails the layer. A failed read becomes held state, logged with its fallback (`UseLedger`'s saved Uses), because a layer that fails stops the plugin.
- The `zotlit-services` lint rules (`apps/obsidian/scripts/oxlint-plugin-services.ts`) enforce the mechanical rules.
- A test fake of a service keeps its type: root `policies/testing-strategy.md` → Service fakes holds the pattern.
- A view reads Effect services through view atoms, and its plain code (an Obsidian callback, a menu item) runs Effects on the leaf's view runner (`apps/obsidian/src/lib/view-runner.ts`), made in the view's constructor and interrupted when the leaf closes: `apps/obsidian/docs/adr/0082-obsidian-views-read-effect-services-through-view-atoms.md` holds the pattern catalogue, the pitfalls and the migration steps. A service a view reads joins `ViewServices` in `apps/obsidian/src/lib/view-atoms.ts`.

## Plugin Shell Notes

- Keep `zt-main.ts` focused on lifecycle wiring, action/menu/view registration, and cleanup.
- Use the `await using` plus `stack.move()` pattern already implemented there for rollback-safe startup.
- Do not treat the plugin `services` getter as normal dependency access. It is an escape hatch/debug surface; services receive deps through `pluginLayer`, and shell registrations through `createPluginRuntime`.
- Wire Obsidian views by closure-capturing the needed services in the `registerView` factory.
- Compose with plain objects and functions in `createPluginRuntime`; service wiring takes no Obsidian `Component` subclass, DI library or other runtime dependency.
