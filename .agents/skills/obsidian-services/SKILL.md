---
name: obsidian-services
description: |
  Service architecture for the Obsidian plugin: Effect services and the legacy Service shell. Use when
  creating, modifying, converting, or wiring services in apps/obsidian/src/services/ or editing zt-main.ts lifecycle code.
---

# Service Architecture

New services are Effect services (see **Effect services**). Everything else in this skill describes the legacy `Service` class, which existing services keep until they convert.

Use the source as the canonical reference. Do not copy service/container/plugin-shell snippets out of this skill; read the current implementation before editing so examples cannot drift from real code.

## Canonical Files

- `apps/obsidian/src/services/service-base.ts`: `Service` (abstract base class), `ServiceContainer`, and other utils.
- `apps/obsidian/src/services/plugin-layer.ts`: `pluginLayer`, the Effect graph and its build order.
- `apps/obsidian/src/services/build.ts`: `buildServices` — builds the runtime over `pluginLayer`, then the legacy container, injecting each graph service through `useValue({ x: () => runtime.runSync(Tag) })`, beside the container's `bridge`.
- `apps/obsidian/src/services/service-layer.ts`: `serviceLayer`, the bridge from a legacy `Service` to a Layer.
- `apps/obsidian/src/lib/effect-layer.ts` and `effect-scope.ts`: where a runtime or Scope meets an `AsyncDisposableStack`.
- `apps/obsidian/src/zt-main.ts`: plugin lifecycle ownership, `await using`, `stack.move()`, cleanup, and debug service access.
- `apps/obsidian/src/lib/disposables.ts`: `Disposable` helpers for `stack.use(...)`.

## Workflow

1. Open `apps/obsidian/src/services/plugin-layer.ts` for the Effect graph and `apps/obsidian/src/services/build.ts` for how `buildServices` builds it and wires the legacy services through `container.use(...)`. For a legacy service, also open `apps/obsidian/src/services/service-base.ts` for `Service`/`ServiceContainer`/`ServiceInitError`. Treat these as authoritative.
2. Open `apps/obsidian/src/zt-main.ts` before changing plugin load/unload behavior. Keep it a thin lifecycle shell.
3. For a new service, create `apps/obsidian/src/services/<service-name>/service.ts` as an Effect service (see **Effect services**), add its layer to `pluginLayer`, and, when legacy code calls it, hand it the tag through `useValue({ x: () => runtime.runSync(Tag) })` in `build.ts`; that code calls it through the container's `bridge`.
4. For a legacy service, co-locate the deps interface with the service class. Use concrete class types via `import type` for upstream services.
5. Register a legacy service in `buildServices` with one keyed `.use(...)` entry. Let the accumulated service type come from the container chain.
6. Pass `plugin`, `plugin.app`, upstream services, and optional deps explicitly through deps objects as needed. Avoid module-global service lookups.
7. Use `apps/obsidian/src/lib/disposables.ts` helpers when adapting Obsidian or DOM registrations into `Disposable` values for `stack.use(...)`.
8. Run the Obsidian package typecheck after edits.

## Service Rules

- Services `extend Service` from `services/service-base.ts`. The base class owns `[Symbol.asyncDispose]` and the `await ready` → `disposeAsync` ordering; subclasses must not override `[Symbol.asyncDispose]`.
- `Service` is generic in the `ready` resolve type. Use plain `extends Service` for startup-only services whose `ready` resolves to `void`; use `extends Service<State>` when `#load()` returns loaded resources/state.
- Do not introduce an Obsidian `Component` subclass, a DI library, or any other runtime dependency for service wiring.
- Constructors call `super()`, store deps, and start startup by assigning `ready` (typically `this.ready = this.#load()`). They must not synchronously acquire resources or throw after startup begins.
- Registration factories should normally be direct constructor calls. Do not construct a service and then run fallible setup before returning it.
- Resource acquisition belongs in startup work guarded by a local `await using stack = new AsyncDisposableStack()`, then handed to the base via `this.commit(stack.move())` on the success path. `commit()` should be the last meaningful side effect before returning the ready state; avoid fallible work after commit. `commit()` throws on double-commit or commit-after-dispose; in those guard-failure paths it also fires off `disposeAsync()` on the passed stack so resources don't leak through the throw (disposal errors there are intentionally swallowed).
- `ready` is startup-only and must always settle. Do not await long-lived/post-load signals such as `workspace.onLayoutReady` inside `ready` — disposal awaits `ready`, so a non-settling `ready` hangs cleanup.
- Service startup waits only for upstream dependency `ready` promises. There is no global readiness gate or scheduler.
- Store deps as private fields instead of reaching through another service to its deps.
- Keep services constructable in isolation with plain mocked deps; lifecycle is driven through `ready` and the base class disposer.
- Sync-only services extend `Service` and initialize `ready = Promise.resolve()`. They do not call `commit()` and do not need a constructor unless they have deps.
- Avoid dependency cycles. If a lazy reference is unavoidable, do not await the lazy target during startup in a way that can create a mutual `ready` dependency.

## Effect services

New services are Effect services: a `Context.Service` tag and a scoped `Layer`, composed in `pluginLayer`. `buildServices` builds that graph first, as a `ManagedRuntime` from `buildRuntime` (`@/lib/effect-layer`), then the legacy container; disposing the runtime closes the graph after the last container service, so a container service never outlives a layer it uses. Settings and logging build below every other layer, so a service logs from its first line. `UseLedger` (`apps/obsidian/src/services/use-ledger/`) is the converted example; its `__fixtures__.ts` builds its layer over a fake App for tests.

- Import Effect from `effect`; the `effectEntry` Vite plugin (`apps/obsidian/scripts/effect-entry.ts`) resolves it to `src/lib/effect.ts`. Its run entry points carry the browser scheduler and the logger, and no graph service.
- The tag shape is Effect-native: each method with arguments is `Effect.fn("<Tag>.<method>")`, a generator or a body that returns an `Effect` (`Effect.fnUntraced` on a per-message or per-item hot path; a test double stays a plain function). A member with no arguments is a `readonly` `Effect` value traced with `Effect.withSpan("<Tag>.<member>")`, and callers write `yield* service.refresh`, not `service.refresh()` (`effecttsgo/lazy-effect` reports a zero-argument method); its test double is an Effect value too. Events are Streams and state:
  - What others watch is a `SubscriptionRef`, exposed as `SubscriptionRef.changes(ref)`: it replays the current value and ends when the layer's finalizer runs `PubSub.shutdown(ref.pubsub)`. A stream that ends on a terminal state adds `Stream.takeUntil`.
  - A discrete occurrence is a `PubSub` exposed as a Stream.
  - A condition a late subscriber must still see (stopped, failed, finished) is state.
- Export the layer beside the tag as `layer<Name>` (a function when it takes plain inputs).
- Callers outside Effect hold the tag's service and the container's `bridge` (`EffectBridge`, `@/lib/effect-bridge`). `build.ts` reads the service once and injects it with `useValue` (`release: () => runtime.runSync(Release)`); consumers type their deps as `Pick<Release["Service"], …>` beside `Pick<EffectBridge, …>` and run each call through the bridge: `runSync`, `runPromise`, `runPromiseExit` (interrupted at unload, for a caller with its own closed answer), `subscribe(stream, callback)`. A fire-and-forget `void bridge.runPromise(…)` runs an Effect that cannot fail. The remaining `<service>/plain.ts` adapters are backlog that retires into the bridge (#1710); write no new one.
- A large state machine may stay a plain class owned by its layer (`zotero-local-api/session.ts`): it publishes events through a callback the layer turns into Streams, and reaches other services through `scopedBridge`, the bridge over the layer's own Scope. A still-legacy consumer that needs the old synchronous surface gets a port over the tag and bridge (`zotero-local-api/port.ts`), made in `build.ts` for that consumer and inside `layerAnnotationRepository` for the repository's engine core.
- A layer reads the events of an Obsidian source that has a capability tag from the tag: `forkEach(filterTag(metadata.changes, "changed"), …)` for `MetadataCache` (`@/lib/obsidian-metadata-cache`). A capability tag registers its listeners through `obsidianEventSource` (`@/lib/obsidian-event-source`); the pattern is in `apps/obsidian/policies/events.md` → Capability tags. A layer registers events from a source with no tag yet (`vault`, `workspace`, and one-shots such as `onLayoutReady`) through `obsidianEvents` (`@/lib/effect-obsidian-events`). Any other Obsidian callback a layer registers runs its Effect through a runner made from the layer's context: `const run = Effect.runSyncWith(yield* Effect.context<never>())`. It keeps the layer's services and Clock, which the bare entry points lack.
- Obsidian's `App` is the `ObsidianApp` tag (`@/lib/obsidian-app`). Time is the Effect `Clock`, and dates in Effect code are `DateTime`; `@/lib/effect-clock` converts them to the `Temporal.Instant` of plain code (`toInstant`, `instantClock`).
- Resources live on the layer's Scope: `Effect.acquireRelease`, `Effect.addFinalizer`, and `acquireDisposable` / `acquireAsyncDisposable` for a value from outside Effect (root `policies/resource-disposal.md` → Effect code).
- Put a side effect behind a tag of its own when a test must replace it. `LogOutput` is the pattern: `layerLogging` drives LogTape through it, and its test supplies a fake whose work takes `TestClock` time.
- An Effect service has no `ready`: the layer has finished building before anyone holds it. Consumers drop `ready` from their deps.
- `buildServices` awaits the layer graph (`runtime.context()`) before it builds the container, so a service anyone holds has finished acquiring. A layer's acquisition replaces the legacy `ready`: it waits for exactly what `#load` waited for, and no more. A wait on outside I/O (the Zotero database, a worker) is bounded with `startupBarrier` (`@/lib/effect-startup`), which keeps the read running on the Scope past the bound. Acquisition settles and never fails the layer. A failed read becomes held state, logged with its fallback (`UseLedger`'s saved Uses), because a layer that fails stops the plugin.
- A legacy service joins the graph through `serviceLayer` (`apps/obsidian/src/services/service-layer.ts`), as `ExcerptImages` and `ExcerptDisplays` do. The layer constructs it and disposes it on scope close, without waiting for `ready`: an Effect service that uses a bridged one awaits its `ready` before the first call, or calls only what the service allows before it (`layerLogging` subscribes to `PluginSettings`).
- An existing legacy service keeps its shape until a change whose purpose is converting it. Convert leaves first, so the services it depends on are already in the graph, and take the file off the legacy list in `apps/obsidian/oxlint.config.ts`.
- The `zotlit-services` lint rules (`apps/obsidian/scripts/oxlint-plugin-services.ts`) enforce the mechanical rules.

## Container Notes

- `ServiceContainer.use()` accepts exactly one service entry and rejects duplicate keys.
- The service key is the object property name in the registration entry.
- `ServiceContainer.useValue()` registers a non-`Service` value with no lifecycle, such as a dependency bundle for composable functions (`note-feature`).
- The container verifies factory return values with `instanceof Service`; a non-`Service` return is a typed error at registration time.
- Startup failures are wrapped in `ServiceInitError` (original error preserved as `cause`) and reported per service. The wrapped rejection — not the original — is what cascades to dependent services that await this service's `ready`.
- `buildServices(plugin, stack)` wires services only; lifecycle ownership remains with the caller's stack in `zt-main.ts`.

## Plugin Shell Notes

- Keep `zt-main.ts` focused on lifecycle wiring, action/menu/view registration, and cleanup.
- Use the `await using` plus `stack.move()` pattern already implemented there for rollback-safe startup.
- Do not treat the plugin `services` getter as normal dependency access. It is an escape hatch/debug surface; services should receive deps through `buildServices`.
- Wire Obsidian views by closure-capturing the needed services in the `registerView` factory.

## External Signals

Pass layout or UI readiness signals as deps when needed, but schedule post-load work instead of making `ready` wait on those signals. Disposal waits for `ready`, so a non-settling `ready` can hang cleanup.

## Example: Service Subclass

The shapes below show the required surface of a `Service` subclass. They are structural templates, not snippets to copy verbatim — always read existing services in `apps/obsidian/src/services/` before authoring a new one, since real services carry their own dep types and resource patterns.

For an async service with deps and acquired resources, read one of:

- `apps/obsidian/src/services/zotero-reads/service.ts` (`ZoteroReadsService extends Service<ZoteroReadsReady>`): `#load()` returns its resources as the `ready` state.
- `apps/obsidian/src/services/item-query/service.ts` (`QueryService`): opens its Effect Scope in `#load()` before the first `await`, awaits upstream `ready`, and commits the stack.

Sync-only service (no deps, no acquired resources):

```ts
export class TimeService extends Service {
  ready = Promise.resolve();

  now(): number {
    return Temporal.Now.instant().epochMilliseconds;
  }
}
```

Sync-only service with deps:

```ts
interface ClockServiceDeps {
  plugin: ZotLitPlugin;
}

export class ClockService extends Service {
  readonly #plugin;
  ready = Promise.resolve();

  constructor(deps: ClockServiceDeps) {
    super();
    this.#plugin = deps.plugin;
  }
}
```

Notes the shape encodes:

- `extends Service`, never `implements Service` (no interface) and never a custom base.
- `super()` first in any explicit constructor.
- Deps stored in `readonly` private (`#`) fields; no public dep fields, no reach-through. Omit the type annotation on the field — let TypeScript infer it from the constructor assignment (`readonly #app;` not `readonly #app: App;`).
- `ready` is a mutable instance field. Declare it as `ready: Promise<State>` and assign in the constructor when load is async and returns state; use `ready: Promise<void>` for async startup with no state; initialize as `ready = Promise.resolve()` when load is sync. Do not mark it `readonly` — the container reassigns it to attach `ServiceInitError` wrapping.
- All resource acquisition lives inside `#load()` under a local `await using stack`, handed off with `this.commit(stack.move())` only on the success path. Treat `commit()` as the last meaningful side effect before returning the ready state.
- Resources acquired during load are returned from `#load()` as the `ready` resolve value; accessors do `const { ... } = await this.ready;` instead of storing nullable resource fields. The exception is a resource that public methods use before `ready` settles: assign it in `#load()` before the first `await` (`QueryService.#jobs`).
- No `[Symbol.asyncDispose]` in the subclass — the base owns it.
