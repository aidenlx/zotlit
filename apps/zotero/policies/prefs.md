# Preferences

Declare defaults in `addon/prefs.js` as `pref("extensions.zotlit.<key>", literal)` (`boolean | number | string` only).

- Hand-prefix every key with `extensions.zotlit.` in `addon/prefs.js`, `addon/prefs.xhtml` (`preference="…"`), and every TS call site.
- Bind XUL controls via `preference="…"` in `addon/prefs.xhtml`.
- In TS use the `prefs` wrapper (`get` / `set` / `onChange` — returns teardown) over raw `Zotero.Prefs.get/set`; register the pane via `registerPrefPane(pluginID)`. Utils in `src/prefs/index.ts`.
- `src/types/prefs.ts` (`PluginPrefKey`) is codegen — commit it, don't edit it.
