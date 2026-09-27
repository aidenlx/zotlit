# @zotlit/obsidian

The Obsidian plugin. Shared constants live in `src/lib/constants.ts`.

## Commands

Run `build` / `test` / `lint` via turbo (see root AGENTS.md → Commands). Package-specific:

- `pnpm --filter @zotlit/obsidian dev` — Vite watch build.
- `I18N_DEV_SERVER=true pnpm --filter @zotlit/obsidian dev` — opt-in when testing multi-language i18n: also serves the generated Language Pack JSONs at `http://127.0.0.1:9092` (or pass a port number) and points the dev build's pack download URL there instead of the GitHub release.
- `pnpm --filter @zotlit/obsidian generate:language-packs` — regenerate the typed message facade and bundled English pack. Only needed when bypassing turbo; turbo `typecheck`/`test` depend on it.
- `pnpm --filter @zotlit/obsidian test:lua-filter` — drive a native Pandoc (3.1.1 or newer) over fixture Markdown to check both `zotlit-cite.lua` variants. Needs `pandoc` on PATH; set `PANDOC_BIN` to check another Pandoc version. Outside `pnpm test`, since it needs a binary the workspace does not install.

## UI stack

Preact provides the UI runtime through `@preact/preset-vite` and its React compatibility aliases. Keep React imports and `@types/react`/`@types/react-dom` for the wider ecosystem.

Read `src/views/annot-view/store.ts` for view state, `menus.ts` and `actions.tsx` for menus, and `src/lib/menu.ts` for anchoring.

The Annotation Marks and the Creation Toolbar inside Obsidian's PDF reader are vanilla DOM ([ADR 0042](docs/adr/0042-the-surfaces-inside-the-pdf-reader-are-vanilla-dom-on-obsidians-popover.md)). The Mark Popup is one Preact root on Obsidian's popover, rendered synchronously by its host ([ADR 0065](docs/adr/0065-the-mark-popup-is-one-preact-root-on-obsidians-popover.md)).

## Note feature

`src/services/note-feature/` is composable free functions over an injected `NoteFeatureDeps` bundle — **not a `Service`**, despite living under `src/services/`. `createNoteFeature(deps)` binds them; read `context.ts` (deps) and `operations.ts` (bound ops) before editing. Batch runners fetch shared context (item tags, note path) once and thread it through the stages, so per-item ops take already-fetched data instead of re-reading.

## Setting tab

Run `/obsidian-settings` for the declarative 1.13 `getSettingDefinitions()` API (controls, sub-pages, migration); build the tab from those definitions alone. Tab lives in `src/setting-tab/index.ts`.

Project-specific: settings live in `SettingsService` under flat dot-notation keys, not `plugin.settings`; the tab bridges `control` keys through `getControlValue`/`setControlValue`.

## Logging

`src/lib/log.ts` provides the logger; `LoggingService` owns configuration.

## UI text (JSON Language Packs)

Import as `import * as m from "@/lib/i18n/generated/messages"`. `src/lib/i18n/generated/` is gitignored and regenerated on build; regenerate manually only when bypassing turbo (see Commands). CLI guide sources live beside their handlers.

When extending `__mocks__/obsidian.ts` for code that calls `m.*` indirectly, add a `getLanguage()` stub returning your fixture locale.

Run `/i18n-ui-text` for wording style; `/inlang-i18n` for JSON format and runtime mechanics.

## CSS

Run `/obsidian-css` for styling tools, tokens, native components, and scoped preflight.

## Debugging

Run `/obsidian-debug` to build, reload, and screenshot the running Obsidian instance.

## Testing

Verify rendered surfaces in the running app through `/obsidian-debug`.

Vitest runs in Node with `"obsidian"` resolved to a local mock via `resolve.alias`. Extend the mock when touching new `obsidian` exports; keep the surface minimal.

- `pnpm exec vitest run path/to/file.test.ts` — single file.
- `pnpm exec vitest` — watch mode.

`sleep` is an Obsidian global that doesn't exist in Node. Use `delay` from `@std/async` instead.

For a macrotask yield between chunks of synchronous work (not a timed wait), use `yieldToMain` from `@/lib/yield-to-main` instead of `sleep(0)`/`delay(0)`: it runs as a `MessageChannel` message task, so it isn't clamped/throttled in hidden or occluded windows the way timer-based yields are, and it works identically under Node (Vitest) with no mock needed.

## Extended Obsidian APIs

Declare private Obsidian runtime APIs in `src/typings/obsidian-ex.d.ts` with `declare module "obsidian" { ... }`. Limit to surface the plugin actually touches; update the Vitest mock separately.
