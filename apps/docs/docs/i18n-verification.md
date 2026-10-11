# Bilingual documentation verification

Base: `next` at `a635872e82a9c753528713c4489b90d9fe7a5c7e`.
Integration branch: `poc/docs-i18n`; [draft PR #1446](https://github.com/aidenlx/zotlit/pull/1446).
Current source checkpoint: `2ee71999fc1836af851764149d3f8001d99b3b9c`, 2026-10-11.
Earlier fixture runtime checkpoint: `ba4b68c7c5e508f86969dd82a724777c399688b3`.

## Current result

The source includes real translations from both PR #1447 and PR #1448. The completion audit covers all 88 Chinese MDX files, 7 navigation files, 110 docs message keys, and 51 native Fumadocs keys. The [per-file coverage report](translation-coverage.md) records the exact source revisions, chosen wording, every content pair, and intentional English. Generated descriptions in the 18 template-data contract tables remain English.

Results are pinned to the source used by each check:

| Check | Observed result | Scope |
| --- | --- | --- |
| Docs tests | 342 passed in 42 files | Correction source `2ee71999`; the earlier fixture checkpoint also passed. |
| TypeScript | App and Node configurations passed | Correction source `2ee71999`. |
| MDX compilation and source parity | All 176 English/Chinese files compile; parity passes | All 29 changed Chinese files retain code, imports, UI calls, explicit IDs, links, and includes. |
| Root lint and formatting | Zero lint errors, five existing warnings; formatting passed across 1,989 files | Correction source `2ee71999`; warnings are outside changed files. |
| Production build | Passed with the normal Cloudflare production configuration | Earlier `ba4b68c7` source plus a temporary English-only documentation fixture. |
| Real-HTTP matrix | 7,746 checks passed; 0 failed; 1,208 requests | Earlier `ba4b68c7` source plus fixture: 91 English HTML pages and their Chinese routes; all 54 legacy rules. |
| Cloud-browser interaction | Passed for the cases below | Earlier `ba4b68c7` hydrated production preview with the fixture. |
| Independent Chinese semantic re-review | Passed; all 39 findings closed, with no new meaning drift | Correction source `2ee71999`; covers all 88 MDX pairs, 110 docs messages, and 7 navigation metadata pairs. |
| Clean post-correction build, checks, and final review | Pending | Runs against the corrected, fixture-free integration tree. |

The temporary fixture has been removed and its preview stopped. Commit `2ee71999` corrects all 39 semantic findings in 29 Chinese MDX files and one docs message. Independent re-review passed on that exact commit. The fixture build and its results are not the final clean-tree result. These local checks do not establish a remote CI, merge, or deployment result. Publication of this translation update is paused.

An earlier test run overlapped with a build and failed while Paraglide output was being regenerated. The serialized rerun passed. Run generation, build, and tests in order when they share that output.

## Implemented behavior

- Paraglide uses request-isolated locale handling and TanStack canonical-route rewrites. English is unprefixed; Simplified Chinese uses `/zh-CN`.
- Native Fumadocs loaders cover docs, blog, and changelog. Docs search filters by locale. Explicit locale inputs select the correct MDX source.
- Actual Chinese file presence selects the Chinese edition and locale metadata. Missing files use English fallback at the requested Chinese URL, with a Chinese notice and one English-page action that preserves query and fragment.
- Static and listing pages use the locale catalogs. There are no translation approval flags, readiness gates, or recursive include approval checks.
- Existing Chinese editions have Chinese canonicals and reciprocal alternate links. Missing-file fallbacks stay English-canonical and `noindex`. Workbench stays `noindex` in both languages. The sitemap includes existing locale editions except Workbench.
- Both native UI dictionaries match all 51 installed registry keys: 50 context-qualified keys plus `displayName`. Tests cover exact registry membership and rendered labels. The former 46 raw keys have been replaced.
- All 1,910 non-docs root-catalog values remain unchanged from the original baseline. The English catalog remains the meaning source. The source integration keeps complementary translations from both PRs and completes the authored prose.

## HTTP matrix

The verifier ran against the normal production preview on an OS-assigned port. The fixture added one English-only page to the build's discovered page inventory for this run. It is excluded from the tracked translation inventory. It discovered the expected native Chinese files rather than treating an English fallback as a Chinese translation.

| Check group | Passed |
| --- | ---: |
| Inventory | 7 |
| Legacy redirect responses | 342 |
| Legacy landing pages | 1,488 |
| HTML and locale metadata | 2,465 |
| Trailing slashes | 362 |
| Markdown editions and content negotiation | 2,816 |
| Search | 14 |
| Errors and Pre-release Docs fallback | 24 |
| Machine endpoints | 43 |
| Concurrent locale isolation | 168 |
| Noncanonical machine requests | 17 |
| **Total** | **7,746** |

The matrix checks discovered English/Chinese route pairs, exact V1 destinations and queries, locale links and sidebars, canonical/alternate/indexing metadata, English fallback actions, Markdown suffix/content/Accept agreement, search, sitemap, machine aliases, errors, and concurrent locale isolation. It exempts only the verified English-page action from locale-link checks; unrelated English links still fail.

HTTP fixtures also test failure cases: an incorrect English destination, lost query, duplicate actions, and unrelated English links, including a second link to the same destination. Verifier CLI tests cover help, invalid options, and startup failure evidence. These remain part of the docs suite.

## Cloud-browser checks

The cloud browser used the production preview served by the supported Linux desktop runtime. The inspected source was `ba4b68c7` plus the temporary English-only fixture.

### Native Chinese content and controls

- The Chinese tutorial rendered its Chinese body and navigation. It had Chinese document language, `index, follow`, a Chinese canonical, and reciprocal English/Chinese/x-default alternate links.
- Hydrated controls displayed Chinese text: `搜索`, `选择语言`, `复制 Markdown`, and `关闭搜索`. Accessible control names were present in Chinese.
- English/Chinese switching preserved `?qa=bilingual#next-steps`, changed the body locale, and changed native UI after hydration.

### Search and navigation

- Searching for `模板` returned Chinese content. Closing and reopening search preserved the query.
- Selecting `模板语法` opened `/zh-CN/docs/reference/templates/syntax` with Chinese body and document language.
- Searching for the fixture's unique English keyword returned its English result at the Chinese fallback URL.
- The Chinese sidebar included the English-only page. Its “Read the tutorial” body link opened the translated Chinese tutorial.

### Missing-file fallback and history

The temporary `/zh-CN/docs/how-to/qa-english-only` page had no Chinese source file.

- The page kept the requested Chinese URL and displayed its English body with Chinese UI and one Chinese notice/action, `阅读英文版`.
- Content metadata stayed English: English canonical, `noindex, follow`, and English/x-default alternates only.
- The English-page action preserved `?from=v1&lang=zh-CN&qa=bilingual#qa-english-only-feature`.
- The English destination displayed English UI and no false fallback warning.
- Back, reload, and Forward restored the corresponding locale, body, and notice state.

### V1 Chinese arrival

`/zh-CN/getting-started/basic-usage/?qa=bilingual&lang=en#next-steps` landed on the Chinese tutorial. Rule-owned `from`, `src`, and `lang` replaced the arrival query; the fragment survived. The destination had Chinese canonical/index metadata and no false untranslated notice.

No app-origin browser errors or warnings were observed. Browser-extension metadata errors were excluded. The external Giscus frame could not connect in this environment. Clipboard behavior was not rechecked.

## Redirect contract

All 54 explicit V1 rules remain in place. Known Chinese V1 pages use `308` to the corresponding Chinese V2 page. Rule-owned notice queries override conflicting arrival queries. External archive rules without their own query retain the arrival query.

- `/getting-started/basic-usage` → `/docs/tutorial?from=v1&src=%2Fgetting-started%2Fbasic-usage`
- `/zh-CN/getting-started/basic-usage` → `/zh-CN/docs/tutorial?from=v1&src=%2Fgetting-started%2Fbasic-usage&lang=zh-CN`
- `/zh-CN/faq/slurp` → `/zh-CN/docs/reference/templates/eta-syntax?from=v1&src=%2Ffaq%2Fslurp&lang=zh-CN`
- `/zh-CN/changelog/v1.1.0` → its exact archived Chinese V1 page

Modern Chinese routes remain live. Unknown ordinary pages return 404. A changelog release absent from Stable Docs forwards to Pre-release Docs with `307`, preserving the locale. Pre-release Docs returns 404 instead of repeating the redirect. Redirect status does not guarantee search rankings.

## Review status and limits

Independent source review compared all 88 English/Chinese MDX pairs, the 7 navigation pairs, and all 110 docs catalog values. It checked meaning, conditions, warnings, side effects, code, variables, links, and remaining authored English. Its 39 findings include restrictions, authorization duration, import scope, property presence, link context, and omitted workflow details. The native dictionary repair was verified separately. The generated contract-table descriptions are the disclosed English exception.

Commit `2ee71999` corrects all 39 findings, including `docs_redirect_original_page`, and independent re-review closed each finding with no new meaning drift. The correction pass preserves code, imports, UI calls, explicit IDs, links, and includes. Final Standards and Spec reviews are pending on the completed source. Prior reviews of the earlier implementation do not cover these later translation changes. The original implementation followed only part of the repository's worktree, ticket, and TDD workflow; later checks do not establish that every workflow step was followed.

HTTP cannot establish hydration, interaction, clipboard access, or fragment behavior. The browser cases above provide the stated interaction evidence. External archive destinations, live GitHub facts, arbitrary historical fragments, translated screenshot pixels, and remote CI were not verified by this checkpoint. The preview warned that `GITHUB_TOKEN` was absent; live GitHub facts are therefore not part of the pass claim.

## Reproduce after corrections

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

Record the final clean build and check results, browser rerun, and Standards/Spec review outcomes here, each with its exact source commit. Use a disposable English-only fixture to exercise missing-file behavior, then remove it and repeat the final normal build and HTTP matrix. See [the editing guide](i18n.md) for content locations and [the coverage report](translation-coverage.md) for the maintained translation inventory.
