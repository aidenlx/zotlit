# @zotlit/zotero

Zotero 9 and Zotero 10 (both Firefox 140 ESR) companion plugin. `strict_min_version` is `9.0` and `strict_max_version` is `10.*`, both in `package.json` under `zotero`. No backward-compat with Zotero 8 or earlier.

## Commands

Run `build` / `test` / `lint` via turbo (see root AGENTS.md → Commands). Package-specific:

- `pnpm --filter @zotlit/zotero dev` — watch build + Zotero reload.

Debug live runtime state (notifiers, `Zotero.*` returns, pref reads, HTTP notify dispatch) by evaluating JS in Zotero's parent process over the dev server's RDP port — use the `/zotero-rdp-debug` skill.

## Rules

### HTTP

Default transport is `fetch`. Switch to `Zotero.HTTP.request` only when need CORS bypass that `fetch` from chrome scope can't do.

### Zotero 9 / 10 API shapes

Both majors are supported, so code that touches an API they shape differently tests for the Zotero 10 shape and falls through to the Zotero 9 one. Test for **presence of the Zotero 10 name** — reading a name Zotero 10 removed can throw rather than return `undefined`, as `collectionTreeRow` does. `src/menus/collection-scope.ts` holds the pattern; `zotero10_dev.md` on the `research/zotero10-wal-stale-reads` branch records the full 9 → 10 diff. Type gaps that `zotero-types` has yet to cover go in `src/types/zotero.d.ts`.

### Patching reader internals

The reader (`reader._internalReader`) lives in the iframe's **content** compartment; the plugin runs in **chrome**. Patch content reader methods by **plain assignment** (`obj.method = fn`) plus restore-on-dispose — never `monkey-around`/`around()`, whose cross-compartment prototype reparenting trips Gecko's security membrane and breaks the reader. `monkey-around` is fine in `apps/obsidian` (single compartment), not here. See `docs/reader-patching.md`.

### Logging

Import `getLogger` directly from `@logtape/logtape` with a category rooted at `["zotlit", "zotero", ...]`. Never call `console.*` or `Zotero.debug` directly from feature code.

```ts
import { getLogger } from "@logtape/logtape";

const logger = getLogger(["zotlit", "zotero", "reader"]);
```

Never call `configure()` here — that belongs to the consuming app.

### Fluent IDs

Hand-prefix every Fluent message ID with `zotlit-` in both `locale/*.ftl` and any `data-l10n-id="…"` in `addon/**/*.xhtml`. Use the FTL filename `zotlit.ftl`, not a generic name.

### Pref keys

Hand-prefix every Zotero pref key with `extensions.zotlit.` in `addon/prefs.js`, `addon/prefs.xhtml` (`preference="…"`), and any TS call site. Prefer the typed wrapper in `src/prefs/index.ts` over raw `Zotero.Prefs.get/set`.

## Localization (l10n)

- Author messages in `locale/{locale}.ftl` (flat, primary `en-US`).
- Menu labels use **Title Case**, matching Zotero's own menus (`Add Note`, `Export Items…`) — not the Obsidian plugin's sentence case. Notice and progress-window copy stays sentence case.
- Menu labels name the **Literature Note** / **Imported Note** vocabulary (see `apps/obsidian/CONTEXT.md`), never bare "note". Entries inside the ZotLit submenu omit "in Obsidian" — the submenu scopes them; entries appended flat to Zotero's own menus keep it.
- Reference XUL strings via `data-l10n-id="…"` in `addon/**/*.xhtml`.
- In TS, format via `formatValue(id, args)`; register menus via `registerMenu(...)`. utils in src/lib/l10n.ts.
- For dynamic menu args (e.g. `$count` plural selection in an `onShowing`), pass a JSON **string**: `context.setL10nArgs(JSON.stringify(args))`. Zotero assigns the value straight to `dataset.l10nArgs` without serializing, so an object becomes `"[object Object]"` and silently disables Fluent selection. The upstream `object`-only type is widened to accept a string in `src/types/zotero.d.ts`.
- `src/types/fluent.ts` (`FluentMessageId`) is codegen — commit it, don't edit it.

## Preferences

- Declare defaults in `addon/prefs.js` as `pref("extensions.zotlit.<key>", literal)` (`boolean | number | string` only).
- Bind XUL controls via `preference="…"` in `addon/prefs.xhtml`.
- In TS, use the `prefs` wrapper (`get` / `set` / `onChange` — returns teardown); register the pane via `registerPrefPane(pluginID)`. utils in src/prefs/index.ts
- `src/types/prefs.ts` (`PluginPrefKey`) is codegen — commit it, don't edit it.
