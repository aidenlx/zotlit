# @zotlit/obsidian

The Obsidian plugin. Shared constants live in `src/lib/constants.ts`.

## Commands

Run `build` / `test` / `lint` via turbo (see root AGENTS.md → Commands). Package-specific:

- `pnpm --filter @zotlit/obsidian dev` — Vite watch build.
- `I18N_DEV_SERVER=true pnpm --filter @zotlit/obsidian dev` — opt-in when testing multi-language i18n: also serves the generated Language Pack JSONs at `http://127.0.0.1:9092` (or pass a port number) and points the dev build's pack download URL there instead of the GitHub release.
- `pnpm --filter @zotlit/obsidian generate:language-packs` — regenerate the typed message facade and bundled English pack. Only needed when bypassing turbo; turbo `typecheck`/`test` depend on it.
- `pnpm --filter @zotlit/obsidian test:lua-filter` — drive a native Pandoc (3.1.1 or newer) over fixture Markdown to check both `zotlit-cite.lua` variants. Needs `pandoc` on PATH; set `PANDOC_BIN` to check another Pandoc version. Outside `pnpm test`, since it needs a binary the workspace does not install.

## Code conventions

Package-specific authoring conventions live in [`policies/`](policies/), one topic per file (root `policies/` still applies):

- [local-storage](policies/local-storage.md) — `app.loadLocalStorage`/`saveLocalStorage`, never `window.localStorage`
- [tooltips](policies/tooltips.md) — `aria-label` is the tooltip; spread `tooltipAttrs` in React
- [file-ops](policies/file-ops.md) — attempt the file op, don't stat-then-fileop; branch on `isErrno`
- [ui-seams](policies/ui-seams.md) — functional core, imperative shell; notices render at the seam, tests assert data
- [cli-text](policies/cli-text.md) — `zotlit:*` CLI output is hardcoded English, never sourced from the Language Pack facade

## UI stack

Preact provides the UI runtime through `@preact/preset-vite` and its React compatibility aliases. Keep React imports and `@types/react`/`@types/react-dom` for the wider ecosystem.

View/modal state uses a zustand **vanilla store + React context, one per instance** — not the global `create()` hook, not signals. Follow `src/views/annot-view/store.ts`.

## Note feature

`src/services/note-feature/` is composable free functions over an injected `NoteFeatureDeps` bundle — **not a `Service`**, despite living under `src/services/`. `createNoteFeature(deps)` binds them; read `context.ts` (deps) and `operations.ts` (bound ops) before editing. Batch runners fetch shared context (item tags, note path) once and thread it through the stages, so per-item ops take already-fetched data instead of re-reading.

## Setting tab

Run `/obsidian-settings` for the declarative 1.13 `getSettingDefinitions()` API (controls, sub-pages, migration). Never React, never a tab library. Tab lives in `src/setting-tab/index.ts`.

Project-specific: settings live in `SettingsService` under flat dot-notation keys, not `plugin.settings`; the tab bridges `control` keys through `getControlValue`/`setControlValue`. The imperative `display()` path under `src/setting-tab/compat/` backs Obsidian < 1.13 and stays decoupled for easy removal.

## Logging

Import `getLogger` from `@/lib/log` — wraps LogTape with parent category `["zotlit", "obsidian"]`:

```ts
import { getLogger } from "@/lib/log";
const logger = getLogger("settings");
```

`LoggingService` owns `configure()` — don't call it anywhere else.

## UI text (JSON Language Packs)

Import as `import * as m from "@/lib/i18n/generated/messages"`. `src/lib/i18n/generated/` is gitignored and regenerated on build; regenerate manually only when bypassing turbo (see Commands). Excludes `zotlit:*` CLI output — see [cli-text](policies/cli-text.md).

When extending `__mocks__/obsidian.ts` for code that calls `m.*` indirectly, add a `getLanguage()` stub returning your fixture locale.

Run `/i18n-ui-text` for wording style; `/inlang-i18n` for JSON format and runtime mechanics.

## CSS

Run `/obsidian-css` for styling decisions (colors, spacing, components, `zt:` prefix, theme tokens, `.zt-root` scoped preflight).

Public theme hooks follow [theme-hooks](policies/theme-hooks.md): central semantic `zt-` classes, cross-surface contract tests, and documented activation rules.

Mark each plugin UI root (`ItemView.contentEl`, modal `contentEl`, settings pane) with `class="zt-root"` — that scope enables the Tailwind preflight so semantic HTML and border utilities render clean. See the skill's **Scoped preflight** section.

Feature styles live next to the code that owns them and are imported from it — `views/<view>/style.css`, `services/<service>/style.css`. The Tailwind entry and styles that belong to no single feature go in `src/zt-main.css`.

## Debugging

Run `/obsidian-debug` to build, reload, and screenshot the running Obsidian instance.

## Testing

Vitest runs in Node with `"obsidian"` resolved to a local mock via `resolve.alias`. Extend the mock when touching new `obsidian` exports; keep the surface minimal.

- `pnpm exec vitest run path/to/file.test.ts` — single file.
- `pnpm exec vitest` — watch mode.

`sleep` is an Obsidian global that doesn't exist in Node. Use `delay` from `@std/async` instead.

For a macrotask yield between chunks of synchronous work (not a timed wait), use `yieldToMain` from `@/lib/yield-to-main` instead of `sleep(0)`/`delay(0)`: it runs as a `MessageChannel` message task, so it isn't clamped/throttled in hidden or occluded windows the way timer-based yields are, and it works identically under Node (Vitest) with no mock needed.

## Extended Obsidian APIs

Declare private Obsidian runtime APIs in `src/typings/obsidian-ex.d.ts` with `declare module "obsidian" { ... }`. Limit to surface the plugin actually touches; update the Vitest mock separately.
