# Spec: Structured data (JSON-LD) for the docs site

Status: ready-for-agent

## Problem Statement

The ZotLit site (`zotlit.aidenlx.site`) emits no structured data. Google has to guess what the site is: search results show a bare domain instead of the site name, no logo is associated with the project, docs results show raw URL paths instead of a readable trail, and blog/changelog pages carry no machine-readable author or date. ZotLit — free software with a landing page, docs, changelog, and blog — is invisible to every applicable feature of Google's structured-data search gallery, so its search presence is worse than the site's content deserves.

## Solution

Each eligible surface emits JSON-LD matching the Google search-gallery feature that applies to it:

- **Homepage** declares three entities: a `WebSite` (drives the site-name treatment in results), an `Organization` for ZotLit (name, logo, and `sameAs` links tying the site to the GitHub repository and the Obsidian community-plugin directory entry), and a `SoftwareApplication` (free, desktop platforms).
- **Blog posts** emit `BlogPosting` with headline, description, dates, and the author as a Person.
- **Changelog Entries** emit `Article` with a version-derived headline and the release date.
- **Docs pages, blog pages, and changelog pages** emit `BreadcrumbList` so results show the page's position in the site hierarchy.

Markup follows the pattern already proven on the maintainer's mx website: a tiny typed render component plus schema objects typed with `schema-dts`, serialized XSS-safely. Deprecated or inapplicable gallery features (FAQ, HowTo, sitelinks search box, Product, Profile page) are deliberately absent. No rating properties are emitted anywhere — there is no legitimate ratings source, and fabricating one violates Google's review-snippet policy.

## User Stories

1. As a prospective user searching Google for ZotLit, I want the result to show the site name "ZotLit" rather than a bare domain, so that the project reads as a real product.
2. As a prospective user, I want Google to know ZotLit is free software for Windows, macOS, and Linux, so that app facts can surface directly in results.
3. As a searcher, I want ZotLit's logo to be eligible for display alongside its search presence, so that results are visually recognizable.
4. As a searcher landing on a docs result, I want a breadcrumb trail in the result instead of a raw URL path, so that I can tell where the page sits in the documentation.
5. As a searcher finding a blog post, I want the result to carry the post's author and publish date, so that I can judge its freshness and provenance.
6. As a user searching for a specific ZotLit release, I want Changelog Entries recognized as dated articles, so that release notes surface with their dates.
7. As the maintainer, I want the site, the GitHub repository, and the Obsidian community-plugin directory entry linked as one identity via `sameAs`, so that search engines consolidate ZotLit's presence instead of treating them as strangers.
8. As the maintainer, I want every schema object typed at compile time, so that malformed markup fails the build instead of shipping.
9. As the maintainer, I want shared identity facts (name, URL, logo, links) defined exactly once, so that pages cannot drift apart.
10. As the maintainer, I want snapshot tests over the emitted schema objects, so that any markup change is visible in review.
11. As the maintainer, I want zero rating/review properties in the markup, so that the site never risks a manual action for self-serving reviews.
12. As the maintainer, I want only live search-gallery features implemented, so that no dead markup (FAQ, HowTo, sitelinks search box) needs maintenance.
13. As the maintainer, I want the same JSON-LD pattern as my other project site, so that maintenance knowledge transfers between the two.
14. As a site visitor, I want the markup to have no visible or performance effect on pages, so that structured data stays invisible plumbing.
15. As the maintainer, I want serialization that neutralizes `<` characters, so that content containing `</script>` can never break out of the script tag.
16. As the maintainer, I want a Changelog Entry without a frontmatter title to get a generated headline from its version, so that markup validity never depends on optional fields.
17. As a future blog author, I want `BlogPosting` markup derived entirely from existing frontmatter, so that publishing a post requires no extra structured-data work.
18. As the maintainer, I want the homepage-level entities emitted only on the homepage, so that other pages' payloads stay lean and placement follows Google guidance.

## Implementation Decisions

- **Render mechanism**: a small server component that takes a `schema-dts` `WithContext<Thing>` object and emits a `<script type="application/ld+json">` via `dangerouslySetInnerHTML`, escaping every `<` to the six-character unicode escape sequence (backslash-u-0-0-3-c). Copied from the mx website implementation.
- **Authoring**: a central builder module in the site's lib layer exports the shared entities (Organization, WebSite, SoftwareApplication) and builder functions (blog posting, changelog article, breadcrumb list) that map page/frontmatter data to schema objects. Routes call builders and render the component; no inline schema literals in pages.
- **Entity linking**: flat standalone nodes, no `@id`/`@graph`. Where an article needs a `publisher`/`author`, the shared Organization or Person object is embedded directly.
- **Organization**: name "ZotLit", url = site base URL, logo = a raster PNG (≥112×112) placed under the public assets, derived from the canonical brand SVGs per the brand spec. `sameAs`: the GitHub repository and `https://community.obsidian.md/plugins/zotlit`.
- **WebSite**: name "ZotLit", url = site base URL. (The sitelinks search box is retired; `WebSite` exists solely for the site-name treatment.)
- **SoftwareApplication**: name "ZotLit", `applicationCategory: "ReferenceApplication"`, `operatingSystem: "Windows, macOS, Linux"` (ZotLit v2 has no mobile support), `offers` with price 0. No `aggregateRating`, no `review` — accepted consequence: the software rich card likely never renders until a legitimate ratings source exists.
- **Placement of homepage entities**: homepage route only — not the root layout (a deliberate divergence from mx, which emits them on every page).
- **Blog posts**: `BlogPosting` with headline/description from frontmatter, `datePublished` from the `date` field, author as a Person (frontmatter `author`, default maintainer, with the maintainer's GitHub profile URL), publisher = the shared Organization.
- **Changelog Entries**: `Article` (not `BlogPosting`, not `NewsArticle`), headline from frontmatter title with fallback `ZotLit v{version}`, `datePublished` from the entry's release date, publisher = the shared Organization.
- **BreadcrumbList**: docs pages (trail from the page tree), blog index and posts, changelog index and entries. The homepage and community page carry no breadcrumb (a one-level trail is noise).
- **Excluded gallery features**: FAQ and HowTo (deprecated by Google), sitelinks search box (retired), Product (Google routes software to the software-app feature), Profile page (meant for forum/social profile pages), Video (no embedded videos yet).
- **Dependency**: `schema-dts` as a package-local devDependency of the docs app (types only, no runtime footprint; not shared with other workspaces, so it stays out of the catalog).
- **Dates**: schema date fields serialize via the Temporal-based conventions already used by the content pipeline, formatted as ISO 8601.

## Testing Decisions

- **The single seam is the builder module**: pure functions from page/frontmatter data to schema objects. Tests assert on the returned objects — the external contract — never on rendering internals.
- Vitest with co-located test files beside the builder module, matching the existing lib-layer tests in the docs app (grammar and error-page-model tests are the prior art).
- Snapshot tests pin each builder's full output; targeted assertions cover the behavioral edges: price is 0, operating-system string excludes mobile, changelog headline falls back to the version, blog author defaults to the maintainer, dates are ISO 8601.
- One unit test on the serializer proves `<` is escaped (a `</script>` payload in a title cannot break out).
- Compile-time `schema-dts` typing is the first line of defense; the type-checking lint pass covers it.
- No rendering/E2E tests. A production build passing plus a one-time manual run of Google's Rich Results Test on each surface completes verification.

## Out of Scope

- **OpenGraph/Twitter metadata enrichment** — the site's `openGraph` blocks only set images (no `type`, `siteName`, `publishedTime`) and there is no Twitter card metadata. Real gap, separate ticket.
- Rating/review markup of any kind, until a legitimate third-party ratings source exists.
- `VideoObject` markup — revisit if docs or blog embed demo videos.
- Any markup for the community page, error pages, or machine routes (RSS, llms.txt, `.md` serving routes, OG image routes).
- The legacy v1 site.
- Search Console property setup or monitoring automation.

## Further Notes

- Google never guarantees rich-result display; the markup makes surfaces eligible, nothing more. The highest-probability visible wins are the site-name treatment (WebSite) and docs breadcrumbs.
- The mx website's JSON-LD implementation is the reference pattern; divergences are deliberate and limited to: homepage-only placement of top-level entities, centralized builders instead of inline per-route literals, and the presence of tests.
- After deploy, run each surface through Google's Rich Results Test and spot-check the rendered `<script>` payloads.
