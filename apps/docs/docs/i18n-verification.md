# i18n proof-of-concept verification

Base: `next` at `a635872e82a9c753528713c4489b90d9fe7a5c7e`.
Review branch: `poc/docs-i18n`; [draft PR #1446](https://github.com/aidenlx/zotlit/pull/1446).
Verified on the cloud Linux workspace, 2026-10-11. No merge or deployment.

## Implemented

- Paraglide URL strategy with request-isolated middleware and TanStack canonical-route rewrites. Exactly English and Simplified Chinese; English URLs stay unprefixed, Chinese uses `/zh-CN`, matching V1.
- Native Fumadocs locale loaders, sidebar trees, language controls, and locale-filtered search for docs, blog, and changelog. Explicit locale server-function inputs select the actual locale MDX files.
- 88 English-copy Chinese MDX files (85 pages, 3 partials), 7 sidebar metadata copies, 106 English-copy `docs_*` additions to the Chinese catalog (105 existing English messages plus the new fallback notice), and 46 native Fumadocs UI dictionary values. All 1,913 preexisting Chinese catalog entries are preserved unchanged. No new translations.
- Placeholder markers drive per-page content language, robots, canonical, reciprocal hreflang, `x-default`, and sitemap membership. A real approved Chinese page becomes Chinese-indexable after marker removal; missing/marked content stays English-canonical and noindex. Workbench remains deliberately noindex. See [translation workflow](i18n.md).
- English pages and machine editions retain the existing 269 prerenders. Chinese pages render through the locale-aware Worker. Global llms/feed/sitemap/robots aliases redirect to the unprefixed inventory; individual Chinese Markdown editions keep their locale.

## Redirect policy

Known Chinese V1 pages permanently move to corresponding Chinese V2 routes. Translation completion and human review are prerequisites for production, so no staged 307 migration is needed. The untranslated POC is not ready to publish. Redirect status does not guarantee search rankings.

Examples (all 308, with the same destinations for trailing-slash V1 aliases):

- `/getting-started/basic-usage` → `/docs/tutorial?from=v1&src=%2Fgetting-started%2Fbasic-usage`
- `/zh-CN/getting-started/basic-usage` → `/zh-CN/docs/tutorial?from=v1&src=%2Fgetting-started%2Fbasic-usage&lang=zh-CN`
- `/zh-CN/faq/slurp` → `/zh-CN/docs/reference/templates/eta-syntax?from=v1&src=%2Ffaq%2Fslurp&lang=zh-CN`
- `/zh-CN/changelog/v1.1.0` → its exact archived Chinese V1 page, not an approximate V2 release.

Modern `/zh-CN`, docs, blog, changelog, and Workbench routes stay live; there is no locale-stripping catch-all. Unknown ordinary pages return 404. Existing unknown-release behavior is an intentional exception: production forwards a missing release to Pre-release Docs using 307, preserving locale; the beta line returns 404 rather than looping.

All 54 explicit asset rules were checked. Rule-owned notice queries override conflicting incoming queries; external rules without target queries retain incoming queries. There are no explicit historical anchor mappings in the baseline inventory. URL helpers preserve fragments, and redirects without a fragment allow browser fragment inheritance, but old anchor existence on the redesigned page is not guaranteed. HTTP cannot verify fragment navigation.

## Passed checks

- Full docs suite: **307 tests, 39 files**.
- App and Node TypeScript checks; Cloudflare generated-type freshness.
- Root lint: zero errors, five existing warnings outside the changed docs code.
- Repository-wide formatting and `git diff --check`.
- Client/SSR production compilation and **269 prerendered routes**, using the temporary environment workaround below.
- Real Vite/Cloudflare workerd HTTP: **8,087 assertions, 1,198 requests, zero failures**. Includes all V1 rules and notice-query precedence; English/Chinese HTML route pairs; sidebar/internal links and Markdown action URLs; locale search; suffix/content/Accept Markdown; slash/case aliases; unknown pages; release fallback; robots, sitemap, feeds and llms; concurrent locale isolation; no leaked placeholder frontmatter.
- Fifteen Worker-boundary regression tests cover global machine aliases, including the unprefixed slash path needed during RSS prerender. Five cases failed before the guard correction and pass after it.
- Temporary future-translation fixture: removed one Chinese tutorial marker and changed only its test title. Real HTTP verified Chinese content language, Chinese canonical, reciprocal en/zh-CN/x-default alternates, sitemap inclusion, no placeholder noindex/banner, and the native Chinese Markdown source. Original placeholder restored afterward; final build and matrix ran with every placeholder intact.
- Independent behavior/SEO review and standards review found no remaining blocking source issues. The fixture-resource cleanup finding was fixed with per-test disposables.

## Reproduce

Use the repository-pinned Node/pnpm toolchain, initialize recursive submodules and Git LFS, and install with the frozen lockfile. No dependency or lockfile changes are required.

```sh
pnpm exec turbo run typecheck test --filter=@zotlit/docs --env-mode=loose
pnpm exec turbo run build --filter=@zotlit/pdf-structure --env-mode=loose
pnpm lint
pnpm format
pnpm exec turbo run build --filter=@zotlit/docs --env-mode=loose
pnpm --filter @zotlit/docs exec node scripts/verify-i18n-http.mjs
pnpm --filter @zotlit/docs check:translations
```

The final command intentionally fails: 96 placeholder files and zero missing counterparts. It is a production readiness gate to run explicitly, not part of the passing POC test suite.

### Cloud environment workaround and limitations

The unchanged production Vite configuration fails in this sandbox when Cloudflare's inspector calls `os.networkInterfaces` (`uv_interface_addresses`, EPERM). For build and HTTP validation, a temporary copy named `.i18n-validation.vite.config.ts` added only `inspectorPort: false` to `cloudflare(...)`. This supported test-only option is absent from the submitted config. Build it with `vite build --config .i18n-validation.vite.config.ts`; pass `--config .i18n-validation.vite.config.ts` to the HTTP script. Remove the temporary file before repository-wide lint/format. The HTTP script starts preview and requests in one process, because this executor isolates loopback between tool calls.

Browser hydration, actual language-selector clicks, and interactive search were **not verified**. Cloud browser launch/socket restrictions, browser namespace reachability, and unavailable official browser downloads prevented a trustworthy browser run. Unit tests and HTTP SSR checks do not replace that gap.

Workerd's optional Request.cf lookup timed out and used its documented placeholder. External GitHub requests encountered DNS failures; existing release-data fail-soft pages still passed. Live release facts and third-party Giscus behavior were not validated.

Parsed Markdown document links are localized without rewriting code or images. Raw HTML/JSX links, unusual escaped leading slashes, and reference definitions shared with images remain authored. HTML internal links were checked. Generated ContractTable prose and shared assets are not newly translated; their review is required before approving the affected Chinese pages. See the workflow for exact scope.

## Primary references

- [Paraglide TanStack Start](https://paraglidejs.com/tanstack-start), [SSR isolation](https://paraglidejs.com/server-side-rendering), [URL routing](https://paraglidejs.com/i18n-routing)
- [Fumadocs i18n](https://www.fumadocs.dev/docs/headless/internationalization/config), [native locale files](https://www.fumadocs.dev/docs/page-conventions), [search locale behavior](https://www.fumadocs.dev/docs/headless/search/orama)
- [Google localized versions](https://developers.google.com/search/docs/specialty/international/localized-versions): reciprocal language alternatives; HTML hreflang is sufficient without duplicating the annotations in sitemap XML.
- [Google noindex](https://developers.google.com/search/docs/crawling-indexing/block-indexing): placeholder URLs remain crawlable so their noindex can be read.
- [Cloudflare asset redirects](https://developers.cloudflare.com/workers/static-assets/redirects/): status and query behavior, verified against the built Worker.
