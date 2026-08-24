# Localization

Author messages in `locale/{locale}.ftl` (flat, primary `en-US`), under the filename `zotlit.ftl`.

- Hand-prefix every message ID with `zotlit-`, in `locale/*.ftl` and in any `data-l10n-id="…"` under `addon/**/*.xhtml`.
- Menu labels use **Title Case**, matching Zotero's own menus (`Add Note`, `Export Items…`) — not the Obsidian plugin's sentence case. Notice, progress-window and status copy stays sentence case.
- Menu labels name the **Literature Note** / **Imported Note** vocabulary (see `apps/obsidian/CONTEXT.md`), never bare "note". Entries inside the ZotLit submenu omit "in Obsidian" — the submenu scopes them; entries appended flat to Zotero's own menus keep it.
- Reference XUL strings via `data-l10n-id="…"`. In TS, format via `formatValue(id, args)` and register menus via `registerMenu(...)` — utils in `src/lib/l10n.ts`.
- For dynamic menu args (e.g. `$count` plural selection in an `onShowing`), pass a JSON **string**: `context.setL10nArgs(JSON.stringify(args))`. Zotero assigns the value straight to `dataset.l10nArgs` without serializing, so an object becomes `"[object Object]"` and silently disables Fluent selection.
- `src/types/fluent.ts` (`FluentMessageId`) is codegen — commit it, don't edit it.
