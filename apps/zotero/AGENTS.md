# @zotlit/zotero

Zotero 9 and Zotero 10 (both Firefox 140 ESR) companion plugin. `strict_min_version` is `9.0` and `strict_max_version` is `10.*`, both in `package.json` under `zotero`. No backward-compat with Zotero 8 or earlier.

## Commands

Run `build` / `test` / `lint` via turbo (see root AGENTS.md → Commands). Package-specific:

- `pnpm --filter @zotlit/zotero dev` — watch build + Zotero reload.

Debug live runtime state (notifiers, `Zotero.*` returns, pref reads, HTTP notify dispatch) by evaluating JS in Zotero's parent process over the dev server's RDP port — use the `/zotero-rdp-debug` skill.

## UI text (Derived Fluent Files)

Author Companion copy under the `zotero` object in `messages/{locale}.json`; the build derives `addon/locale/{locale}/zotlit.ftl` from it and regenerates `src/types/fluent.ts`, which is committed. A production build fails when that file is stale — rerun it and commit. Format in TS through `formatValue` / `requireMessage` / `l10nArgs` from `@/lib/l10n`, typed over `FluentMessages`; reference XUL through `data-l10n-id`, checked at build.

Run `/i18n-ui-text` for wording style (menu labels are the Title Case exception); `/inlang-i18n` for JSON format. The generator in `scripts/vite-fluent-plugin.ts` owns ID mapping and attributes.

## Logging

`src/lib/logger.ts` owns logging setup.
