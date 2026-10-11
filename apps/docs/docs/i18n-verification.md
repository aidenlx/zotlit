# Bilingual documentation verification

Base: `next` at `a635872e82a9c753528713c4489b90d9fe7a5c7e`.
Integration branch: `poc/docs-i18n`; [draft PR #1446](https://github.com/aidenlx/zotlit/pull/1446).
Current source checkpoint: `eed6e1790dd642c66329e41bc70a7178395acc51`, 2026-10-11.
Clean runtime checkpoint: `eed6e1790dd642c66329e41bc70a7178395acc51`; runtime-equivalent published revision: `db3f5b6237dd26c660e283923db149b86c2b0cb0`.
Latest missing-file fixture checkpoint: `a1d3d7d1566b349b8122111089df249d505e279a` plus a temporary English-only file.

## Current result

The source includes real translations from both PR #1447 and PR #1448. The inventory covers all 88 Chinese MDX files, 7 navigation files with 7 translated titles, and 157 root docs message keys. Those keys include 47 native messages that supply all 51 Fumadocs registry contexts through the generated facade. The [per-file coverage report](translation-coverage.md) records current blob IDs, source decisions, every content pair, and intentional English. Generated descriptions in the 18 template-data contract tables remain English.

Results are pinned to the source used by each check:

| Check | Observed result | Scope |
| --- | --- | --- |
| Docs tests | 350 passed in 42 files | Final clean runtime source `eed6e179`. |
| TypeScript | App and Node configurations passed | Final clean runtime source `eed6e179`. |
| MDX compilation and source parity | All 176 English/Chinese files compile | At `2233815f`, the 22 changed Chinese pages preserve fences, explicit anchors, and Markdown/JSX links. UI labels intentionally use new component imports and catalog calls. Metadata-only `a1d3d7d1` changes no MDX file. |
| Root lint and formatting | Zero lint errors, five existing warnings; formatting passed | Metadata source `a1d3d7d1`; warnings are outside changed files. |
| Production build | Normal Cloudflare build passed; 533 routes | Clean `eed6e179`: includes 90 Chinese HTML assets and 174 Chinese Markdown assets. |
| Real-HTTP matrix | 7,948 checks passed; 0 failed; 1,198 requests | Clean `eed6e179`: 90 English HTML pages and their Chinese routes, all 54 legacy rules, and 264 native Chinese asset checks. |
| Cloud-browser interaction | Root-backed Chinese UI, body links, search/breadcrumbs, fragment scrolling, locale switching, history, reload, and metadata passed | Clean `eed6e179`; no fixture links or app-origin console errors. V1 cases passed in the preceding unchanged redirect implementation. |
| Independent Chinese semantic re-review | All 39 original findings closed; no new meaning drift | Earlier `2ee71999`: all 88 MDX pairs, the original 110 docs messages, and 7 metadata pairs. Does not cover the later Standards edits. |
| Standards re-review | Zero open findings or smells | Final independent closure at `eed6e179`; original findings and the test package-root helper issue remain closed. |
| Spec re-review | Zero implementation findings | Final independent delta review at `eed6e179`. |
| Language delta review | Zero open findings; 39 prior findings and the generated-anchor finding are closed | Final independent verification at `eed6e179`; covers the 22 changed MDX files, all 47 native messages, the modified message, and root metadata. |
| Compiled heading preservation | All 896 heading IDs match `2ee71999` across all 88 Chinese files | `eed6e179`; the regression failed before the explicit-ID fix and passed afterward. |
| Latest missing-file fixture | Normal 536-route build and 8,013 HTTP checks passed; browser fallback and Chinese breadcrumb passed | `a1d3d7d1` plus fixture; 1,208 requests, zero failures, 264 native asset checks. |
| Final clean runtime reruns | Passed | Fixture removed before the normal build, HTTP matrix, and clean browser pass at `eed6e179`. |

Commit `a1d3d7d1` adds the root title “文档”, a native page-tree regression, and HTTP assertions for Chinese search breadcrumbs. It changes one metadata file and two check files. The missing-file fixture pass verifies that metadata and root-backed fallback UI. The later `6ff764e2` changes only a test package-root helper. `eed6e179` adds one explicit Chinese heading ID and its regression; final clean runtime checks pass on that source. Final-report-head remote CI has not yet been established. Local validation and source publication do not establish merge or deployment.

Concurrent test/lint/HTTP runs produced resource timeouts during the Standards pass; serialized reruns passed. An earlier test/build overlap also failed during Paraglide regeneration and passed on a serialized rerun. Run shared-output and resource-intensive checks in order.

## Implemented behavior

- Paraglide uses request-isolated locale handling and TanStack canonical-route rewrites. English is unprefixed; Simplified Chinese uses `/zh-CN`.
- Native Fumadocs loaders cover docs, blog, and changelog. Docs search filters by locale. Explicit locale inputs select the correct MDX source.
- Actual Chinese file presence selects the Chinese edition and locale metadata. Missing files use English fallback at the requested Chinese URL, with a Chinese notice and one English-page action that preserves query and fragment.
- Static and listing pages use the locale catalogs. There are no translation approval flags, readiness gates, or recursive include approval checks.
- Native Chinese HTML and Markdown editions are prerendered with English and can be served from the asset layer. Missing-file Chinese fallback remains Worker-rendered.
- Existing Chinese editions have Chinese canonicals and reciprocal alternate links. Missing-file fallbacks stay English-canonical and `noindex`. Workbench stays `noindex` in both languages. The sitemap includes existing locale editions except Workbench.
- The root catalogs own all UI copy. The [Fumadocs adapter](../src/lib/fumadocs-translations.ts) maps 47 generated messages to all 51 native registry keys: 50 context-qualified keys plus `displayName`. App-local dictionaries have been removed. Tests cover registry membership, displayed/accessibility labels, and URL interpolation.
- All 1,910 non-docs root-catalog values remain unchanged from the original baseline. The English catalog remains the meaning source. The source integration keeps complementary translations from both PRs and completes the authored prose.

## HTTP matrix

The latest matrix ran against the clean `eed6e179` normal production preview on an OS-assigned port. It discovers native Chinese files independently of English fallback and verifies their emitted HTML/Markdown assets. There was no temporary fixture in this run.

| Check group | Passed |
| --- | ---: |
| Native Chinese assets | 264 |
| Inventory | 7 |
| Legacy redirect responses | 342 |
| Legacy landing pages | 1,488 |
| HTML and locale metadata | 2,436 |
| Trailing slashes | 358 |
| Markdown editions and content negotiation | 2,784 |
| Search | 17 |
| Errors and Pre-release Docs fallback | 24 |
| Machine endpoints | 43 |
| Concurrent locale isolation | 168 |
| Noncanonical machine requests | 17 |
| **Total** | **7,948** |

The matrix checks discovered English/Chinese route pairs, exact V1 destinations and queries, locale links and sidebars, canonical/alternate/indexing metadata, English fallback actions, Markdown suffix/content/Accept agreement, search, sitemap, machine aliases, errors, and concurrent locale isolation. It exempts only the verified English-page action from locale-link checks; unrelated English links still fail.

HTTP fixtures also test failure cases: an incorrect English destination, lost query, duplicate actions, and unrelated English links, including a second link to the same destination. Verifier CLI tests cover help, invalid options, and startup failure evidence. These remain part of the docs suite.

## Cloud-browser checks

The cloud browser used the production preview served by the supported Linux desktop runtime. Results below distinguish the current rendering design from the earlier missing-file fixture.

### Final clean browser pass at `eed6e179`

- Root-backed native Chinese controls hydrate correctly. A body card opens `/zh-CN/docs/tutorial/first-note` with Chinese heading and body.
- Searching for `模板` shows the breadcrumb `文档` → `参考` → `模板` and the `模板语法` result. Selecting it opens the Chinese syntax page.
- The migration fragment `在-zotero-中确认文献引用标识` exists, retains the current vocabulary heading, and scrolls to the intended section.
- The shared `#spread-entries` target exists and scrolls in both locales. Switching preserves `?qa=final#spread-entries`; English native UI becomes English.
- Back, Forward, Back, and reload restore the correct locales.
- Chinese content has `zh-CN` document language, `index, follow`, a Chinese canonical, and reciprocal English/Chinese/x-default alternates.
- No temporary fixture links or app-origin console errors/warnings were observed.

The preceding `2233815f` browser pass also checked root-backed external page-action links: they contained the actual Chinese page URL with no literal `{url}`; destinations were not followed. It verified trailing-slash Chinese V1 arrival, rule-owned query values, preserved fragments, Chinese metadata, and no false fallback notice. That implementation is unchanged by the later metadata, test-helper, and heading-ID corrections.

Browser-extension metadata errors were excluded, and the external Giscus frame could not connect. Clipboard and plugin host-app behavior were not tested.

### Latest missing-file fixture at `a1d3d7d1`

The temporary `/zh-CN/docs/how-to/qa-english-only` page had no Chinese source file. The normal fixture build emits 536 routes. Its HTTP matrix passed 8,013 checks across 1,208 requests, including 264 native asset checks and the Chinese breadcrumb assertions. The fixture was then removed and is excluded from the tracked translation inventory.

- The requested Chinese URL displayed English body with Chinese native controls, notice, and exactly one `阅读英文版` action.
- Content metadata stayed English: English document language/canonical and `noindex`.
- The hydrated action preserved `?from=v1&lang=zh-CN&qa=native#qa-english-only-feature`. Its English destination displayed English controls and no false fallback warning.
- Back and reload restored the Chinese URL and notice.
- Searching the unique English keyword showed `文档`, `操作指南`, and the fixture's English title. Selecting the result opened the same Chinese fallback URL.
- No app-origin console errors or warnings were observed; browser-extension metadata errors were excluded.

The tutorial body link was clicked, but its destination was not independently observed before the tab closed. This step is not counted as passed in the fixture run. The final clean pass separately verified the actual first-note destination from a body card.


## Redirect contract

All 54 explicit V1 rules remain in place. Known Chinese V1 pages use `308` to the corresponding Chinese V2 page. Rule-owned notice queries override conflicting arrival queries. External archive rules without their own query retain the arrival query.

- `/getting-started/basic-usage` → `/docs/tutorial?from=v1&src=%2Fgetting-started%2Fbasic-usage`
- `/zh-CN/getting-started/basic-usage` → `/zh-CN/docs/tutorial?from=v1&src=%2Fgetting-started%2Fbasic-usage&lang=zh-CN`
- `/zh-CN/faq/slurp` → `/zh-CN/docs/reference/templates/eta-syntax?from=v1&src=%2Ffaq%2Fslurp&lang=zh-CN`
- `/zh-CN/changelog/v1.1.0` → its exact archived Chinese V1 page

Modern Chinese routes remain live. Unknown ordinary pages return 404. A changelog release absent from Stable Docs forwards to Pre-release Docs with `307`, preserving the locale. Pre-release Docs returns 404 instead of repeating the redirect. Redirect status does not guarantee search rankings.

## Review status and limits

Independent language review at `2ee71999` compared all 88 English/Chinese MDX pairs, the 7 navigation pairs, and the original 110 docs messages. It checked meaning, conditions, warnings, side effects, code, variables, links, and remaining authored English. Its 39 findings were corrected and independently closed with no new meaning drift. Generated contract-table descriptions are the disclosed English exception.

The later Standards review found six documented-standard breaches and one duplication issue. Commit `2233815f` addresses native asset prerendering, root-catalog UI ownership, Chinese terminology, message-backed current UI labels, scoped test cleanup, optional-parameter conventions, and shared Markdown route parsing. It updates 22 Chinese MDX files, adds 47 root messages, and corrects the Companion wording in one existing message. Final independent Standards review at `eed6e179` reports zero open documented findings or smells after the additional test-helper and anchor corrections. Final Spec review at the same commit reports zero implementation findings. The language delta review covers the 22 MDX changes, all 47 native messages, the modified introduction, and the root title; it found no new meaning or interpolation error. Its one P3 generated-anchor finding is fixed by `eed6e179`. That fix preserves all 896 compiled heading IDs from the earlier reviewed content. Independent language verification at `eed6e179` closes that final finding and confirms all 39 earlier findings remain closed. The final review gate is passed at this exact source. The fixture-free build, HTTP matrix, and clean browser pass also passed on that source.

The original implementation followed only part of the repository's worktree, ticket, and TDD workflow. Later checks do not establish that every workflow step was followed.

HTTP cannot establish hydration, interaction, clipboard access, or fragment behavior. The browser cases above provide the stated evidence. External archive destinations, live GitHub facts, arbitrary historical fragments, translated screenshot pixels, and remote CI are outside this checkpoint's verification. A missing GitHub token and blocked external Giscus frame limit live external content checks.

## Reproduce the checks

Use the repository's pinned toolchain and initialized dependencies. Run shared-output steps in order:

```sh
pnpm exec turbo run test --filter=@zotlit/docs
pnpm --filter @zotlit/docs typecheck
pnpm lint
pnpm format
pnpm exec turbo run build --filter=@zotlit/docs
pnpm --filter @zotlit/docs exec node scripts/verify-i18n-http.mjs --help
pnpm --filter @zotlit/docs exec node scripts/verify-i18n-http.mjs
```

The default preview port is assigned by the OS. `--port` selects a specific port. `--expected-html` is optional; without it, the verifier requires a non-empty discovered inventory. The tool writes JSON evidence and a text summary to its configured output directory.

For later changes, record new clean build/check results, browser evidence, and review outcomes here with their exact source commit. Use a disposable English-only fixture to exercise missing-file behavior, then remove it and repeat the final normal build and HTTP matrix. See [the editing guide](i18n.md) for content locations and [the coverage report](translation-coverage.md) for the maintained translation inventory.
