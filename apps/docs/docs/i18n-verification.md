# i18n proof-of-concept verification

Base: `next` at `a635872e82a9c753528713c4489b90d9fe7a5c7e`.
Review branch: `poc/docs-i18n`; [draft PR #1446](https://github.com/aidenlx/zotlit/pull/1446).
Verified source: `1aec53043329326a69597b38cdefe633aec91327`, 2026-10-11. No merge or deployment.

## Current behavior

- Paraglide uses request-isolated locale handling and TanStack canonical-route rewrites. English is unprefixed; Simplified Chinese uses `/zh-CN`.
- Native Fumadocs loaders cover docs, blog, and changelog. Docs search filters by locale. Explicit locale inputs select the correct MDX source.
- Actual Chinese file presence selects the Chinese edition and its locale metadata. Missing files use English fallback at the same Chinese URL, with an English-page action that preserves query and fragment.
- Static and listing pages use the locale catalogs. There are no translation approval flags, readiness gates, or recursive include approval checks.
- Chinese editions have Chinese canonicals and reciprocal alternate links. Missing-file fallbacks stay English-canonical and `noindex`. Workbench stays `noindex` in both languages. The sitemap includes existing locale editions except Workbench.
- The 88 Chinese MDX files, 7 navigation files, 107 added Chinese catalog values, and 46 native UI dictionary values remain English copies. All 1,913 preexisting Chinese catalog values are unchanged. File presence makes no claim about language or translation quality. Translate before publishing.

## Redirects

All 54 explicit V1 rules remain unchanged. Known Chinese V1 pages use `308` to the corresponding Chinese V2 page. Rule-owned notice queries override conflicting arrival queries. External archive rules without their own query retain the arrival query.

- `/getting-started/basic-usage` → `/docs/tutorial?from=v1&src=%2Fgetting-started%2Fbasic-usage`
- `/zh-CN/getting-started/basic-usage` → `/zh-CN/docs/tutorial?from=v1&src=%2Fgetting-started%2Fbasic-usage&lang=zh-CN`
- `/zh-CN/faq/slurp` → `/zh-CN/docs/reference/templates/eta-syntax?from=v1&src=%2Ffaq%2Fslurp&lang=zh-CN`
- `/zh-CN/changelog/v1.1.0` → its exact archived Chinese V1 page

Modern Chinese routes remain live. Unknown ordinary pages return 404. A missing changelog release on Stable Docs forwards to Pre-release Docs with `307`, preserving the locale; Pre-release Docs returns 404 to prevent a loop. Redirect status does not guarantee search rankings.

## Local checks

- Docs suite: 335 tests in 41 files pass in normal order and shuffled with seed `1446`.
- App and Node TypeScript checks pass.
- Scoped docs lint passes. Whole-tree oxlint passes with five existing warnings in other packages.
- Repository-wide formatting and `git diff --check` pass.
- Real-HTTP verifier fixtures pass with two concurrent OS-assigned preview ports. Negative fixtures reject an incorrect English path, a lost query, duplicate actions, and unrelated English links, including a second link with the same URL.
- Native loader, search, SEO, fallback DOM, and hydration tests pass. The native-file assertions failed against the earlier approval-based implementation before this change.

## Verification scope

The retained tests cover native locale loaders and docs search, native-file-based SEO, English-only page fallback, fallback-notice DOM and hydration, and query/fragment preservation. The verifier CLI has tests for help, option validation, and startup failure evidence.

The HTTP verifier checks discovered English/Chinese route pairs, exact V1 destinations and queries, localized links and sidebars, locale metadata, English fallback actions, Markdown suffix/content/Accept agreement, search, sitemap, machine aliases, errors, and concurrent locale isolation. It reads native source-file presence for its expected Chinese editions. It exempts only a verified English action from locale-link checks; unrelated English links still fail.

Run from the repository root after the normal docs build:

```sh
pnpm --filter @zotlit/docs exec node scripts/verify-i18n-http.mjs --help
pnpm --filter @zotlit/docs exec node scripts/verify-i18n-http.mjs
```

The default preview port is assigned by the OS. `--port` can select a specific port. `--expected-html` is optional; without it, the verifier requires a non-empty discovered inventory. JSON evidence and a text summary default to `.scratch/i18n-poc/`.

## Integrated build and browser evidence

- The normal production-line Cloudflare build passed after the final source cleanup and prerendered 269 pages. No alternate production config or inspector workaround was used. The supported cloud desktop runtime was used because the command executor has an inspector `EPERM` limitation.
- The final full HTTP matrix passed 7,681 checks across 1,198 requests, with zero failures. It used an OS-assigned preview port and covered 90 English HTML pages plus their Chinese routes and all 54 legacy rules.
- Real cloud-browser checks passed on the simplified implementation: a temporary English-only page stayed at its Chinese URL, rendered English with one fallback action, and had English canonical/noindex metadata. The action preserved query and fragment; the English destination had no false notice. Switching, back/forward, reload, sidebar inclusion, locale search, and internal links passed.
- Native Chinese files rendered without a fallback notice and had Chinese canonical/index metadata and reciprocal alternates. Chinese V1 arrival preserved the locale and fragment, with the exact Chinese archive link. Rule-owned redirect queries replaced the arrival query as specified above.
- The temporary file was removed. After the final source cleanup, a clean build and browser pass repeated locale switching with URL context, search selection, body-link navigation, back/forward, reload, metadata, and absence of fixture links. No app console errors or warnings were observed. The external Giscus iframe could not connect in this environment.

## Code review

The final full-PR Standards and Spec reviews ran independently against the same pinned tree. Both report zero implementation findings after one fixer resolved the findings. The review tree is identical to the published source above. Inherited English wording in the requested copies was recorded separately and left unchanged. The formal review gate is complete; this does not claim that the initial implementation followed every worktree, ticket, and TDD step of the repository workflow.

## Limits

HTTP cannot test hydration, interaction, clipboard access, or fragments; browser checks provide the interaction evidence listed above. Clipboard behavior was not rechecked in this pass. External redirect destinations are not fetched by the matrix. Live GitHub facts and old fragment targets are not verified. The Chinese text is still unfinished.

Plugin documentation links are a separate task and are outside this docs checkpoint. See [the editing guide](i18n.md) for locale file locations and production considerations.
