# @zotlit/zotero

Zotero 9 (Firefox 140 ESR) companion plugin. No backward-compat with Zotero 8 or earlier.

## Rules

### HTTP

Default transport is `fetch`. Switch to `Zotero.HTTP.request` only when need CORS bypass that `fetch` from chrome scope can't do.

### Logging

Always via LogTape `getLogger(["zotlit", "zotero", ...])`. Never call `console.*` or `Zotero.debug` directly from feature code.

### Fluent IDs

Hand-prefix every Fluent message ID with `zotlit-` in both `locale/*.ftl` and any `data-l10n-id="…"` in `addon/**/*.xhtml`. Use the FTL filename `zotlit.ftl`, not a generic name.

### Pref keys

Hand-prefix every Zotero pref key with `extensions.zotlit.` in `addon/prefs.js`, `addon/prefs.xhtml` (`preference="…"`), and any TS call site. Prefer the typed wrapper in `src/prefs/index.ts` over raw `Zotero.Prefs.get/set`.

## Localization (l10n)

- Author messages in `locale/{locale}.ftl` (flat, primary `en-US`).
- Reference XUL strings via `data-l10n-id="…"` in `addon/**/*.xhtml`.
- In TS, format via `formatValue(id, args)`; register menus via `registerMenu(...)`. utils in src/lib/l10n.ts.
- `src/types/fluent.ts` (`FluentMessageId`) is codegen — commit it, don't edit it.

## Preferences

- Declare defaults in `addon/prefs.js` as `pref("extensions.zotlit.<key>", literal)` (`boolean | number | string` only).
- Bind XUL controls via `preference="…"` in `addon/prefs.xhtml`.
- In TS, use the `prefs` wrapper (`get` / `set` / `onChange` — returns teardown); register the pane via `registerPrefPane(pluginID)`. utils in src/prefs/index.ts
- `src/types/prefs.ts` (`PluginPrefKey`) is codegen — commit it, don't edit it.
