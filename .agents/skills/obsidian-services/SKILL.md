---
name: obsidian-services
description: |
  Service architecture patterns for the Obsidian plugin. Use when creating, modifying, or wiring
  services in apps/obsidian/src/services/ or editing zt-main.ts lifecycle code.
---

# Service Architecture

Use the source as the canonical reference. Do not copy service/container/plugin-shell snippets out of this skill; read the current implementation before editing so examples cannot drift from real code.

## Canonical Files

- `apps/obsidian/src/services/service-base.ts`: `Service` (abstract base class), `ServiceContainer`, and other utils.
- `apps/obsidian/src/services/build.ts`: `buildServices` wiring.
- `apps/obsidian/src/zt-main.ts`: plugin lifecycle ownership, `await using`, `stack.move()`, cleanup, and debug service access.
- `apps/obsidian/src/lib/disposables.ts`: `Disposable` helpers for `stack.use(...)`.

## Workflow

1. Open `apps/obsidian/src/services/service-base.ts` first for `Service`/`ServiceContainer`/`ServiceInitError` definitions and JSDoc. Open `apps/obsidian/src/services/build.ts` to see how `buildServices` wires services through `container.use(...)`. Treat both as authoritative.
2. Open `apps/obsidian/src/zt-main.ts` before changing plugin load/unload behavior. Keep it a thin lifecycle shell.
3. For a new service, create `apps/obsidian/src/services/<service-name>/service.ts`.
4. Co-locate the service deps interface with the service class. Use concrete class types via `import type` for upstream services.
5. Register the service in `buildServices` with one keyed `.use(...)` entry. Let the accumulated service type come from the container chain.
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

## Container Notes

- `ServiceContainer.use()` accepts exactly one service entry and rejects duplicate keys.
- The service key is the object property name in the registration entry.
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

The shape below shows the required surface of a `Service` subclass. It is a structural template, not a snippet to copy verbatim — always read existing services in `apps/obsidian/src/services/` before authoring a new one, since real services carry their own dep types and resource patterns.

Async service with deps and acquired resources:

```ts
import { Service } from "../service-base";
import type { SettingsService } from "../settings/service";

interface DatabaseState {
  conn: Connection;
}

interface DatabaseServiceDeps {
  plugin: ZotLitPlugin;
  settings: SettingsService;
}

export class DatabaseService extends Service<DatabaseState> {
  #plugin;
  #settings;
  ready: Promise<DatabaseState>;

  constructor(ctx: DatabaseServiceDeps) {
    super();
    this.#plugin = ctx.plugin;
    this.#settings = ctx.settings;
    this.ready = this.#load();
  }

  async #load(): Promise<DatabaseState> {
    await this.#settings.ready;

    await using stack = new AsyncDisposableStack();
    const conn = stack.adopt(
      await openDatabase(),
      async (conn) => await conn.close(),
    );
    await this.#runMigrations(conn);

    this.commit(stack.move());
    return { conn };
  }

  async query(sql: string): Promise<Result> {
    const { conn } = await this.ready;
    return conn.query(sql);
  }
}
```

Sync-only service (no deps, no acquired resources):

```ts
export class TimeService extends Service {
  ready = Promise.resolve();

  now(): number {
    return Date.now();
  }
}
```

Sync-only service with deps:

```ts
interface ClockServiceDeps {
  plugin: ZotLitPlugin;
}

export class ClockService extends Service {
  #plugin;
  ready = Promise.resolve();

  constructor(ctx: ClockServiceDeps) {
    super();
    this.#plugin = ctx.plugin;
  }
}
```

Notes the shape encodes:

- `extends Service`, never `implements Service` (no interface) and never a custom base.
- `super()` first in any explicit constructor.
- Deps stored in private (`#`) fields; no public dep fields, no reach-through.
- `ready` is a mutable instance field. Declare it as `ready: Promise<State>` and assign in the constructor when load is async and returns state; use `ready: Promise<void>` for async startup with no state; initialize as `ready = Promise.resolve()` when load is sync. Do not mark it `readonly` — the container reassigns it to attach `ServiceInitError` wrapping.
- All resource acquisition lives inside `#load()` under a local `await using stack`, handed off with `this.commit(stack.move())` only on the success path. Treat `commit()` as the last meaningful side effect before returning the ready state.
- Resources acquired during load are returned from `#load()` as the `ready` resolve value; accessors do `const { ... } = await this.ready;` instead of storing nullable resource fields.
- No `[Symbol.asyncDispose]` in the subclass — the base owns it.
