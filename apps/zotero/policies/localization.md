# Localization

Author Companion copy under the top-level `zotero` object in `messages/{locale}.json` (base locale `en`). The build derives `addon/locale/{locale}/zotlit.ftl` from it (ADR 0027); the Derived Fluent Files are build output, never edited by hand. Zotero looks for `en-US`, so `en` lands there.

- **ID mapping**: `zotero.menu_item_open.label` emits `zotlit-menu-item-open` with the Fluent Attribute `.label`. The message segment converts snake case to kebab case and takes the `zotlit-` prefix; the build owns the prefix, so a key never spells it. A plain string, or a `value` leaf beside attributes, is the message value. One level of attribute nesting only.
- **Attributes are structure**: a label, a tooltip, or an access key is a nested leaf under the message (`{ "label": "…", "tooltiptext": "…" }`), never a suffix on the key.
- **Variants**: use the array-wrapped complex form with `declarations`, `selectors`, and `match`; every selector level needs a `*` catch-all or the build fails. A `count: plural` local becomes Fluent's implicit CLDR selection on `$count`.
- **Menu labels use Title Case**, matching Zotero's own menus (`Add Note`, `Export Items…`), the one exception to the sentence case in `/i18n-ui-text`. Notice, progress-window and status copy stays sentence case.
- Menu labels name the **Literature Note** / **Imported Note** vocabulary (see `apps/obsidian/CONTEXT.md`), never bare "note". Entries inside the ZotLit submenu omit "in Obsidian" — the submenu scopes them; entries appended flat to Zotero's own menus keep it.
- Reference XUL strings via `data-l10n-id="…"`; the build checks every reference under `addon/**/*.xhtml` against the emitted IDs. In TS, format via `formatValue(id, args)` and register menus via `registerMenu(...)` — utils in `src/lib/l10n.ts`; both are typed over `FluentMessages`, so a missing or misspelled input is a type error.
- For dynamic menu args (e.g. `$count` plural selection in an `onShowing`), pass a JSON **string**: `context.setL10nArgs(JSON.stringify(args))`. Zotero assigns the value straight to `dataset.l10nArgs` without serializing, so an object becomes `"[object Object]"` and silently disables Fluent selection.
- A message a locale leaves untranslated is omitted from that locale's file and warned about at build time; Fluent falls back to `en-US` per message. A message missing from `en`, or a locale input `en` never declares, fails the build.
- `src/types/fluent.ts` (`FluentMessages`, `FluentMessageId`) is codegen — commit it, don't edit it.
