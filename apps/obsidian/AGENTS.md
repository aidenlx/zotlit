# @zotlit/obsidian

The Obsidian plugin. Shared constants live in `src/lib/constants.ts`.

## Commands

Run `build` / `test` / `lint` via turbo (see root AGENTS.md → Commands). Package-specific:

- `pnpm --filter @zotlit/obsidian dev` — Vite watch build.
- `pnpm --filter @zotlit/obsidian paraglide:compile` — recompile Paraglide messages. Only needed for direct-tool iteration that bypasses turbo (e.g. `pnpm exec vitest`/`tsc`); turbo `typecheck`/`test` depend on it.

## Logging

Import `getLogger` from `@/lib/log` and create a logger at module level:

```ts
import { getLogger } from "@/lib/log";

const logger = getLogger("settings");
// or, for deeper namespacing:
const logger = getLogger(["zotero", "library"]);

logger.info("Loaded {count} items", { count });
```

The root category is `["zotlit", "obsidian"]`; whatever you pass becomes a child of it.

`LoggingService` owns the `configure()` lifecycle — it subscribes to `SettingsService` and reapplies on every change to `log.level` / `log.to-file`. Don't call `configure()` anywhere else.

**Bootstrap-tier exception.** The following call sites legitimately use `console.*` — they run before `LoggingService.#load()` configures LogTape, or are themselves part of the logging plumbing:

- `zt-main.ts` (plugin onload/unload — onload runs before any service `ready` has settled; unload runs after services have already been disposed).
- `services/build.ts` and `services/service-base.ts` (service wiring errors — fired during DI registration, before any service is ready).
- `services/settings/service.ts` (load path, save errors, subscriber errors — settings runs strictly before `LoggingService`, so it can't depend on a configured logger).
- `services/log/vault-sink.ts` (sink-failure fallback — when the file sink itself is what's reporting a write error, routing through LogTape would just feed it back into the broken sink).

Anywhere else, use `getLogger`.

### What to log

Every service must emit basic lifecycle and operation logs. At minimum:

- **`info`** — service ready/disposed, and outcome of each public operation (with counts / `durationMs`).
- **`debug`** — per-item decisions, cache hits, watcher events, query params.
- **`warn`** / **`error`** — handled-but-unexpected vs. failed operations (always include the `error` field).

Aggregate hot loops into one summary log; don't log per-iteration at `info`.

## UI text (Paraglide JS)

All user-facing strings come from Paraglide message functions; never hardcode UI text.

```ts
import * as m from "@/paraglide/messages";

new BaseNotice(m.notice_indexed_library({ count }));
```

- **Compilation**: `paraglideVitePlugin` in `vite.config.ts` re-emits `src/paraglide/` on every `dev`/`build`/`build:dev`. The output is gitignored, so the compiled `m.*` and `paraglide/runtime` exports do not exist yet on fresh checkout.
- **Turbo auto-compiles**: `typecheck` and `test` declare `dependsOn: ["paraglide:compile"]` (see `turbo.json`), so running them through turbo regenerates `src/paraglide/` first.
- **Recompile manually** only when bypassing turbo (e.g. `pnpm exec vitest run` or a direct `tsc` after editing `messages/*.json`): `pnpm run paraglide:compile`.

When extending the test `__mocks__/obsidian.ts` for code that calls `m.*` indirectly, add a `getLanguage()` stub returning your fixture locale.

Run `/i18n-ui-text` skill when authoring or editing the wording of UI strings (command names, setting labels, button text, notices). It inlines Obsidian's house style rules — sentence case, imperatives, preferred terminology — so the copy matches the rest of the Obsidian ecosystem. Use it alongside `/paraglide-i18n`, which covers the JSON message format and `m.*` runtime.

## Notices and toasts

Use `BaseNotice` from `@/lib/notice` and `toast.promise` from `@/lib/toast` — never raw `new Notice(...)` from `obsidian`. Read `src/lib/notice.ts` and `src/lib/toast.ts` for the API surface (`BaseNotice`, `BaseNotice.render`, `toast.promise`).

## CSS

View-specific styles live next to the view (e.g. `views/<view>/style.css`) and are imported from that view's entry module. Only put truly global styles in `src/zt-main.css`.

**Tailwind prefix (`zt:`).** Theme and utilities imports use `prefix(zt)` — write every utility as `zt:flex`, `zt:gap-2`, `zt:hover:opacity-100`, `zt:@md:columns-2`. 

## Testing

Vitest runs in Node and resolves `"obsidian"` to a local mock via
`resolve.alias`. Types still come from `packages/obsidian-api`.

Run the full task via turbo (see root AGENTS.md → Commands). For tight iteration, call Vitest directly from this package:

- `pnpm exec vitest run path/to/file.test.ts` — single file.
- `pnpm exec vitest` — watch mode.

Extend the mock when a service starts touching new `obsidian` exports; add the
new symbol and keep the surface minimal.

`function sleep(ms: number): Promise<void>` is an Obsidian global (see `packages/obsidian-api/obsidian.d.ts`); it doesn't exist in Node. If module need to work in tests, use `delay` from `@std/async` instead.

## Extended Obsidian APIs

When the plugin uses private Obsidian runtime APIs that are missing from
`packages/obsidian-api/obsidian.d.ts`, declare them in
`src/typings/obsidian-ex.d.ts` with `declare module "obsidian" { ... }`. Keep
the augmentation limited to runtime surface the plugin actually touches, and
update the Vitest mock separately when tests need that value.
