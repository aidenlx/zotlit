# @zotlit/obsidian

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

## UI text (Paraglide JS)

All user-facing strings come from Paraglide message functions; never hardcode UI text.

```ts
import * as m from "@/paraglide/messages";

new BaseNotice(m.notice_indexed_library({ count }));
```

- **Compilation**: `paraglideVitePlugin` in `vite.config.ts` re-emits `src/paraglide/` on every `dev`/`build`/`build:dev`. The output is gitignored, so the compiled `m.*` and `paraglide/runtime` exports do not exist yet on fresh checkout.

When extending the test `__mocks__/obsidian.ts` for code that calls `m.*` indirectly, add a `getLanguage()` stub returning your fixture locale.

Run `/i18n-ui-text` skill when authoring or editing the wording of UI strings (command names, setting labels, button text, notices). It inlines Obsidian's house style rules — sentence case, imperatives, preferred terminology — so the copy matches the rest of the Obsidian ecosystem. Use it alongside `/paraglide-i18n`, which covers the JSON message format and `m.*` runtime.

## Notices and toasts

Do **not** call `new Notice(...)` from `obsidian` directly. Use the wrappers in `@/lib/notice` and `@/lib/toast` so every toast picks up the `.zt-notice` styling and shared behavior.

### Plain notice — `BaseNotice`

For a one-shot string with no actions, use `new BaseNotice(message, duration?)`. It's a drop-in for Obsidian's `Notice` that adds the `.zt-notice` class.

```ts
import { BaseNotice } from "@/lib/notice";
import * as m from "@/paraglide/messages";

new BaseNotice(m.notice_export_failed());
```

### Notice with actions — `BaseNotice.render`

`BaseNotice.render(cb)` returns a `DocumentFragment` with a title element and an actions row. Pass it to `new BaseNotice(frag)` or any API that accepts a `DocumentFragment` (including `toast.promise`).

```ts
import { BaseNotice } from "@/lib/notice";
import * as m from "@/paraglide/messages";

new BaseNotice(
  BaseNotice.render((renderer) => {
    renderer.setTitle(m.notice_login_required());
    renderer.addAction((button) => {
      button.setButtonText(m.action_login()).onClick(() => {
        void this.#deps.auth.openLoginDialog();
      });
    });
  }),
);
```

### Promise-driven flow — `toast.promise`

Use `toast.promise` for any async user action where the user benefits from a loading → success/error transition (refresh, sync, import, export). It debounces the loading toast (default 200ms), reuses the same `Notice` for each phase, and silently drops `AbortError` rejections.

```ts
import * as toast from "@/lib/toast";
import * as m from "@/paraglide/messages";

void toast.promise(db.refresh(), {
  loading: m.notice_db_refreshing(),
  success: m.notice_db_refreshed(),
  error: m.notice_db_refresh_failed(),
});
```

Pass `swallowError: false` if the caller needs the resolved value or wants to react to the rejection itself; otherwise the toast is the only side effect.

## Testing

Vitest runs in Node and resolves `"obsidian"` to a local mock via
`resolve.alias`. Types still come from `packages/obsidian-api`.

Run from this package:

- `pnpm test` — typechecks `tsconfig.test.json` with tsgo, then runs `vitest run`.
- `pnpm typecheck:test` — typecheck only (no test execution).
- `pnpm exec vitest run path/to/file.test.ts` — single file, no typecheck.
- `pnpm exec vitest` — watch mode.

Extend the mock when a service starts touching new `obsidian` exports; add the
new symbol and keep the surface minimal.
