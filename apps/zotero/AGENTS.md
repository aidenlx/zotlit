# @zotlit/zotero

Zotero 9 (Firefox 140 ESR) companion plugin. No backward-compat with Zotero 8 or earlier.

## Rules

### HTTP

Default transport is `fetch`. Switch to `Zotero.HTTP.request` only when need CORS bypass that `fetch` from chrome scope can't do.

### Logging

Always via LogTape `getLogger(["zotlit", "zotero", ...])`. Never call `console.*` or `Zotero.debug` directly from feature code.

### Fluent IDs

Hand-prefix every Fluent message ID with `zotlit-` in both `addon/locale/**/*.ftl` and any `data-l10n-id="…"` in `addon/**/*.xhtml`. Use the FTL filename `zotlit.ftl`, not a generic name.

### Pref keys

Hand-prefix every Zotero pref key with `extensions.zotlit.` in `addon/prefs.js`, `addon/prefs.xhtml` (`preference="…"`), and any TS call site. Prefer the typed wrapper in `src/prefs/index.ts` over raw `Zotero.Prefs.get/set`.
