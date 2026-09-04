# @zotlit/zotero

Zotero 9 and Zotero 10 (both Firefox 140 ESR) companion plugin. `strict_min_version` is `9.0` and `strict_max_version` is `10.*`, both in `package.json` under `zotero`. No backward-compat with Zotero 8 or earlier.

## Commands

Run `build` / `test` / `lint` via turbo (see root AGENTS.md → Commands). Package-specific:

- `pnpm --filter @zotlit/zotero dev` — watch build + Zotero reload.

Debug live runtime state (notifiers, `Zotero.*` returns, pref reads, HTTP notify dispatch) by evaluating JS in Zotero's parent process over the dev server's RDP port — use the `/zotero-rdp-debug` skill.

## Conventions

Package-specific authoring conventions live in [`policies/`](policies/), one topic per file (root `policies/` still applies):

- [http](policies/http.md) — `fetch` by default; `Zotero.HTTP.request` only for CORS bypass
- [zotero-api-shapes](policies/zotero-api-shapes.md) — test for the Zotero 10 name, fall through to Zotero 9
- [reader-patching](policies/reader-patching.md) — plain assignment, never `monkey-around` across the compartment boundary
- [chrome-injection](policies/chrome-injection.md) — registries first; a hand-injected node is owned and removed
- [localization](policies/localization.md) — copy under `zotero` in `messages/*.json`, derived FTL, Title Case menus, JSON-string l10n args
- [prefs](policies/prefs.md) — `extensions.zotlit.` keys, the typed wrapper, codegen types
- [dates](policies/dates.md) — native `Date` and `Intl`; this runtime has no `Temporal`

## UI text (Derived Fluent Files)

Author Companion copy under the `zotero` object in `messages/{locale}.json`; the build derives `addon/locale/{locale}/zotlit.ftl` from it and regenerates `src/types/fluent.ts`, which is committed. A production build fails when that file is stale — rerun it and commit. Format in TS through `formatValue` / `requireMessage` / `l10nArgs` from `@/lib/l10n`, typed over `FluentMessages`; reference XUL through `data-l10n-id`, checked at build.

Run `/i18n-ui-text` for wording style (menu labels are the Title Case exception); `/inlang-i18n` for JSON format; [localization](policies/localization.md) for the ID mapping and attribute shape.

## Logging

Import `getLogger` directly from `@logtape/logtape` with a category rooted at `["zotlit", "zotero", ...]`. Never call `console.*` or `Zotero.debug` directly from feature code.

```ts
import { getLogger } from "@logtape/logtape";

const logger = getLogger(["zotlit", "zotero", "reader"]);
```

This package is the app, so it owns `configure()` — `setupLogging()` in `src/lib/logger.ts` is the only call site. Never call it from feature code.
