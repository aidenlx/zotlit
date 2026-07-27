# @zotlit/obsidian

The Obsidian plugin. Shared constants live in `src/lib/constants.ts`.

## Commands

Run `build` / `test` / `lint` via turbo (see root AGENTS.md → Commands). Package-specific:

- `pnpm --filter @zotlit/obsidian dev` — Vite watch build.
- `pnpm --filter @zotlit/obsidian paraglide:compile` — recompile Paraglide messages. Only needed when bypassing turbo (e.g. `pnpm exec vitest`/`tsc`); turbo `typecheck`/`test` depend on it.

## Code conventions

Package-specific authoring conventions live in [`policies/`](policies/), one topic per file (root `policies/` still applies):

- [local-storage](policies/local-storage.md) — `app.loadLocalStorage`/`saveLocalStorage`, never `window.localStorage`
- [tooltips](policies/tooltips.md) — `aria-label` is the tooltip; spread `tooltipAttrs` in React
- [file-ops](policies/file-ops.md) — attempt the file op, don't stat-then-fileop; branch on `isErrno`
- [ui-seams](policies/ui-seams.md) — functional core, imperative shell; notices render at the seam, tests assert data

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

## UI text (Paraglide JS)

Import as `import * as m from "@/paraglide/messages"`. `src/paraglide/` is gitignored and generated on build; recompile manually only when bypassing turbo (see Commands).

When extending `__mocks__/obsidian.ts` for code that calls `m.*` indirectly, add a `getLanguage()` stub returning your fixture locale.

Run `/i18n-ui-text` for wording style; `/paraglide-i18n` for JSON format and runtime API.

## CSS

Run `/obsidian-css` for styling decisions (colors, spacing, components, `zt:` prefix, theme tokens, `.zt-root` scoped preflight).

Mark each plugin UI root (`ItemView.contentEl`, modal `contentEl`, settings pane) with `class="zt-root"` — that scope enables the Tailwind preflight so semantic HTML and border utilities render clean. See the skill's **Scoped preflight** section.

View-specific styles live next to the view (`views/<view>/style.css`). Global styles go in `src/zt-main.css`.

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
