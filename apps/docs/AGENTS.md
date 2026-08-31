<!-- intent-skills:start -->
## Skill Loading

Before editing files for a substantial task:
- Run `pnpm dlx @tanstack/intent@latest list` from the workspace root to see available local skills.
- If a listed skill matches the task, run `pnpm dlx @tanstack/intent@latest load <package>#<skill>` before changing files.
- Use the loaded `SKILL.md` guidance while making the change.
- Monorepos: when working across packages, run the skill check from the workspace root and prefer the local skill for the package being changed.
- Multiple matches: prefer the most specific local skill for the package or concern you are changing; load additional skills only when the task spans multiple packages or concerns.
<!-- intent-skills:end -->

The block above is vendor-generated. This repo's own skills come first — load them by name, and reach for `@tanstack/intent` only where no repo skill covers the task.

# @zotlit/docs

ZotLit documentation site — TanStack Start (SSR React) + Tailwind CSS v4, deployed to Cloudflare Workers.

## Commands

Run `build` / `test` / `lint` via turbo (see root AGENTS.md → Commands). Package-specific:

- `pnpm --filter @zotlit/docs dev` — Vite dev server.
- `pnpm --filter @zotlit/docs preview` — serve the built Worker locally through workerd.
- `pnpm --filter @zotlit/docs deploy` — build, then `wrangler deploy` to Cloudflare Workers.
- `pnpm --filter @zotlit/docs deploy:beta` — the same for Pre-release Docs. `CLOUDFLARE_ENV` picks the Cloudflare environment at build time, so the beta build has to be its own; a build made without it carries the production line's variables whatever `wrangler deploy --env` says.
- `pnpm --filter @zotlit/docs cf-typegen` — regenerate the committed `worker-configuration.d.ts` from `wrangler.jsonc`. Both TypeScript configurations consume it; run this command after a Worker binding, variable, secret, compatibility date, or compatibility flag changes. The typecheck verifies that the generated file is current.
- `pnpm --filter @zotlit/docs codegen` — regenerate the `.source/` collection index (`fumadocs-mdx`); `postinstall` and `vite build` already run it.
- `pnpm --filter @zotlit/docs generate:i18n` — regenerate the typed Paraglide facade from the root Inlang project; dev, build, and typecheck already run it.
- `pnpm exec turbo run generate:template-data --filter=@zotlit/docs` — regenerate the template-data reference page.

## Content pipeline

- **Collections:** Read [`source.config.ts`](source.config.ts) before changing frontmatter, partial discovery, Markdown editions, or syntax highlighting. It owns those rules and the three collection schemas.
- **Dates:** `publishedOn` in [`src/lib/shared.ts`](src/lib/shared.ts) normalizes every publication date to an ISO day, for both the collections and the build-time content scan; workerd lacks Temporal, so this schema, the reader-facing date helpers beside it — the two release-date formatters and the footer's copyright year — and the `Date` the `feed` library takes in [`src/routes/changelog/rss[.]xml.ts`](<src/routes/changelog/rss[.]xml.ts>) are a package-scoped exception to [the Temporal policy](../../policies/temporal-dates.md).

## Routing

- **Server side:** [`src/lib/source.ts`](src/lib/source.ts) reads `collections/server` and stays server-only. Routes reach it through `createServerFn` handlers, which return JSON — a page's file path, its frontmatter, the sidebar tree.
- **MDX bodies:** compile through `collections/browser`. Each route builds a client loader with `createClientLoader`, calls `preload(path)` in its loader, and renders `getComponent(path)`. The table of contents rides with the compiled module, so it never crosses the server boundary.
- **Redirects and headers:** [`src/lib/v1-redirects.ts`](src/lib/v1-redirects.ts) owns the v1 permalink table; a Vite plugin in [`vite.config.ts`](vite.config.ts) renders it into `dist/client/_redirects` and `_headers`, which the Cloudflare asset layer answers without a Worker invocation.
- **Search:** [`src/routes/api/search.ts`](src/routes/api/search.ts) serves `/api/search` from `createFromSource` over the docs loader alone, so the changelog and the blog stay unindexed. Its only `createFileRoute` property is `server`, which keeps it out of the client route tree and out of any prerender pass. The dialog is the fumadocs default and needs no client wiring.
- **Markdown editions:** every page publishes its authored Markdown at two URLs — `<page>.md` and `/llms.mdx/<section>/…/content.md`. [`src/lib/markdown-routes.ts`](src/lib/markdown-routes.ts) owns that scheme; the `rewrite` in [`src/router.tsx`](src/router.tsx) folds the `.md` suffix onto the content route, so [`src/routes/llms[.]mdx/$.ts`](<src/routes/llms[.]mdx/$.ts>) answers both. Bodies and the two `llms*.txt` indexes come from [`src/lib/markdown-editions.ts`](src/lib/markdown-editions.ts).
- **Prerendering:** [`src/lib/prerender-pages.ts`](src/lib/prerender-pages.ts) lists every route `tanstackStart({ pages })` writes into the client output — the Markdown surface, the SEO endpoints, and each HTML page whose body is settled at build time. Vite loads its config outside the app's module graph, so the content half of that list comes from [`src/lib/content-scan.ts`](src/lib/content-scan.ts), which reads the content directory instead of the collections. Automatic discovery stays off. Every HTML page is on the list; the Worker renders only `/api/search`, the two release-fact endpoints, and the Pre-release Docs fallback — a changelog version this build never published misses the asset layer and lands on the Worker, where the route answers. [ADR 0025](../../docs/adr/0025-the-docs-site-prerenders-asset-first-and-falls-through-to-an-ssr-worker.md) explains the shape.
- **Negotiation:** [`src/server.ts`](src/server.ts) is the Worker's entry — it wraps the default TanStack Start handler, so `wrangler.jsonc` points `main` at it. `run_worker_first` puts the Worker ahead of the asset layer on the HTML page paths alone; there it applies fumadocs' `isMarkdownPreferred` and rewrites the path with `negotiatedContentRoute` from [`src/lib/markdown-routes.ts`](src/lib/markdown-routes.ts), then hands the request to the `ASSETS` binding and falls through to SSR only when no file answers. The asset call keeps `redirect: "manual"`, so a `_redirects` rule still reaches the reader as its own redirect.
- **Pre-release Docs fallback:** a changelog version absent from the build 307s to the beta line — the page ([`src/routes/_home/changelog/$version.tsx`](<src/routes/_home/changelog/$version.tsx>)), its Markdown edition, and its OG card ([`src/routes/og/$.ts`](<src/routes/og/$.ts>)) each hand on their own path through [`src/lib/beta-fallback.ts`](src/lib/beta-fallback.ts). The gate is the `DOCS_LINE` Worker variable: Pre-release Docs sets it to `beta` and answers 404 instead of redirecting to itself.
- **GitHub data:** [`src/lib/release-data.ts`](src/lib/release-data.ts) fetches the install pages' Version Ledger and `.xpi` link plus the landing and community counters, each cached about an hour at the edge and each failing soft — a page loses its ledger or its counters, never itself. The `GITHUB_TOKEN` Worker secret raises the API rate limit. The MDX components sit far below their route, so the snapshot reaches them through [`src/components/release-snapshot.tsx`](src/components/release-snapshot.tsx) rather than as props. Every page that shows these facts prerenders with the data its build saw and refreshes it after mount: the landing and community pages bake the counters, which `<RepoDatum>` replaces with the latest from [`src/routes/api/repo-stats.ts`](<src/routes/api/repo-stats.ts>); the install pages bake the snapshot, which the provider replaces with the latest from [`src/routes/api/release-snapshot.ts`](<src/routes/api/release-snapshot.ts>). Both refreshes are one behaviour, owned by [`src/lib/use-baked-then-fresh.ts`](src/lib/use-baked-then-fresh.ts): baked until the response lands, and on a failed lookup the baked value stands.
- **Client-side widgets:** [`src/components/redirect-notice.tsx`](src/components/redirect-notice.tsx) reads the `?from=v1` / `?lang=zh-CN` query contract after mount, since the pages it sits on are prerendered without a query; [`src/components/comments.tsx`](src/components/comments.tsx) mounts giscus on a blog post, keyed on the post's path.
- **Release availability:** [`src/lib/docs-availability.ts`](src/lib/docs-availability.ts) reads a page's `introduced` / `updated` against the Docs Release Line in [`zotlit-release.json`](zotlit-release.json) and stays server-side, so `semver` never reaches the browser. The `/docs` route shell decorates the page tree before it crosses the `createServerFn` boundary and [`src/layouts/docs/slots/sidebar.tsx`](src/layouts/docs/slots/sidebar.tsx) renders the resulting `NEW` / `UPDATED` pill; [`src/components/docs-page.tsx`](src/components/docs-page.tsx) hands the page's availability to [`src/components/docs-availability.tsx`](src/components/docs-availability.tsx) for the `AVAILABLE SINCE` row; [`src/lib/markdown-editions.ts`](src/lib/markdown-editions.ts) leads each docs edition and `llms-full.txt` with the `_Available since ZotLit …._` preamble.

## Styling

The site wears the "Manuscript & Machine" design. Its spec — theme, the four-face type system, label voice, per-surface notes, and the CSS architecture rule — is [`DESIGN.md`](DESIGN.md). Read it before touching typography, fonts, theming, color tokens, chrome, or layout.

- **Tokens:** [`src/styles.css`](src/styles.css) holds the whole CSS layer — the `--color-fd-*` palette for both schemes, the `@theme inline` font wiring, the `#toc-title` anchor, and the scrollbar rules. Prose styling stays out of it: [`src/lib/prose.ts`](src/lib/prose.ts) expresses the docs/blog body (`ztProse`) and the changelog type roles (`changelogProseRoles`) as typography element modifiers, which each surface applies inline.
- **Fonts:** Fontsource serves all four faces from this package's own assets. The `@import`s in `src/styles.css` register them; `--font-sans` / `--font-serif` / `--font-mono` / `--font-brand` in the same file assign the roles. Metric-adjusted local fallback faces in that stylesheet preserve the shift-free swaps that `next/font` generated before the TanStack Start migration. [`src/routes/__root.tsx`](src/routes/__root.tsx) preloads Gelasio's upright and italic latin faces for serif display; Inter and IBM Plex Mono stay unpreloaded behind their adjusted fallbacks. The Archivo wordmark subset needs no preload — it is under Vite's `assetsInlineLimit`, so the build inlines it into the stylesheet.
- **Owned layout slots:** `src/layouts/` vendors three fumadocs slots — [home header](src/layouts/home/slots/header.tsx), [docs sidebar](src/layouts/docs/slots/sidebar.tsx), and [docs page footer](src/layouts/docs/page/slots/footer.tsx) — plus [`src/components/banner.tsx`](src/components/banner.tsx), whose `height` is a floor so the strip wraps rather than overflows. Each vendors only its own file and imports everything else from package entry points, so a fumadocs bump means re-diffing four files. [`src/components/docs-subnav.tsx`](src/components/docs-subnav.tsx) wraps the packaged docs header for the mobile double-hairline instead of vendoring it.

## SEO and machine endpoints

- **Page head:** [`src/lib/seo.ts`](src/lib/seo.ts) builds one route `head` fragment — title, description, canonical, OpenGraph, Twitter, and the page's JSON-LD. [`src/routes/__root.tsx`](src/routes/__root.tsx) carries the site-wide defaults; TanStack merges head tags by `name`/`property`, so a page names only what differs. The schema.org objects come from [`src/lib/structured-data.ts`](src/lib/structured-data.ts).
- **Sitemap:** [`src/lib/sitemap.ts`](src/lib/sitemap.ts) keys its table off `FileRouteTypes["to"]` minus a named list of machine routes. A new page route leaves a `Record` key missing and fails the typecheck; a new machine route fails the `satisfies` instead.
- **Binary assets:** the OG cards ([`src/lib/og-card.tsx`](src/lib/og-card.tsx), [`src/lib/og-cards.ts`](src/lib/og-cards.ts)) and the agent-skill archives ([`src/lib/agent-skills.ts`](src/lib/agent-skills.ts)) are emitted by the `machineAssets` plugin in [`vite.config.ts`](vite.config.ts), which also serves them in dev. They skip the prerender pass because it writes every response as text, and they need Node — takumi renders natively and the archives read the workspace. Archive URLs pin to the build's commit.

## Verification

- [`http.test.ts`](src/http.test.ts) is the primary seam: it serves `dist/` through workerd and asserts what a browser sees — page status, redirect targets, Accept-header negotiation, the Pre-release Docs fallback on both lines, which routes carry a prerendered file, Markdown editions, search results, sitemap and robots content, feed items, OG card content types, agent-skill digests, JSON-LD, and asset headers. It walks the page list from the loaders, so a page the prerender scan or the card scan misses fails there. Run it through turbo so the build runs first.
- [`source.test.ts`](src/lib/source.test.ts) pins that each collection discovers content, that the docs collection carries pages alone and leaves the `_` partials to `<include>`, that the changelog and the blog come back newest-first, and that a frontmatter date normalizes to an ISO day. [`gfm.test.ts`](src/lib/template-contract/gfm.test.ts) pins generated Markdown tables. [`v1-redirects.test.ts`](src/lib/v1-redirects.test.ts) pins the rendered rule files. [`docs-availability.test.ts`](src/lib/docs-availability.test.ts) pins the badge and preamble derivation.

## Deployment

- The worker is named `zotlit-docs` and serves the production line on `zotlit.aidenlx.site`, a wrangler custom domain. `.github/workflows/docs-deploy.yml` deploys every push on `main`, the stable branch — a gate job asks turbo whether the push touched `@zotlit/docs` or its dependency closure and skips the deploy otherwise; it needs the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets.
- The `beta` environment deploys as `zotlit-docs-beta`, the Pre-release Docs line, on `zotlit-beta.aidenlx.site` with `DOCS_LINE` set to `beta`. The same workflow deploys it from `next`, the pre-release branch; the branch picks the wrangler environment for both the build and the deploy.
- Two values come from outside the repo: the `GITHUB_TOKEN` Worker secret (`wrangler secret put GITHUB_TOKEN`, per environment) and `VITE_CF_BEACON_TOKEN`, the public Cloudflare Web Analytics site token read at build time. Each line has its own Web Analytics site, so the workflow picks the token by branch. Without the beacon token the site serves no analytics script.
- Four settings live in the Cloudflare dashboard rather than in `wrangler.jsonc`, and survive a deploy: each Worker route is set to **fail open**, so a Worker outage falls through instead of erroring; **AI Crawl Control** blocks the abusive crawler operators; one **WAF rate-limit rule** covers the HTML page paths; and **Web Analytics** is enabled for the site token the build reads. Giscus' allowed origins (`giscus.json` at the repo root) list both lines' domains, so blog comments load on Pre-release Docs as well.

## Generated template-data reference

`content/docs/reference/templates/data.mdx` is generated from the `zt` type comments in `packages/db/src/lib/context/`. Edit those comments, run `pnpm --filter @zotlit/db generate:contract`, then run the Turbo task above.

[`src/lib/template-contract/sections.ts`](src/lib/template-contract/sections.ts) owns the section structure. The `_*.mdx` partials beside the generated page own supplementary prose.

The page's Markdown edition renders each `<ContractTable>` as a GFM table through the `stringify` callback on the docs collection's `includeProcessedMarkdown` in [`source.config.ts`](source.config.ts).

## Content and writing docs

Content lives in `content/`; collections and schemas are defined in [`source.config.ts`](source.config.ts). `content/docs/` follows Diataxis.

Read `/docs-writing` to scope content decisions, then delegate prose to the `docs-writer` agent.

Custom MDX components (`src/components/`) are imported per-page in the `.mdx`, not registered in [`src/components/mdx.tsx`](src/components/mdx.tsx); wrap them in `not-prose` and style over `--color-fd-*` tokens (see [`src/components/action-link.tsx`](src/components/action-link.tsx)).

**UI Labels:** When docs quote a command, setting, option, menu item, button, or tooltip, follow [`policies/ui-labels.md`](policies/ui-labels.md).

Give any heading that is a deep-link target (linked from another page, a changelog entry, or an issue reply as `/path#anchor`) a stable custom anchor via fumadocs' `[#slug]` syntax, e.g. `## Section title [#bulk]`. The auto-generated slug tracks the heading text, so rewording it silently breaks inbound links; a short custom id does not. Reference: https://www.fumadocs.dev/docs/markdown#toc-settings

Image attachments (screenshots, etc.) go under `public/img/<collection>/` as `.webp`, not `.png`/`.jpg` — convert with `cwebp` before committing.

Adding a page type to the social (OG) cards: add its entry to `ogTypes` in [`src/lib/shared.ts`](src/lib/shared.ts), give it a card in [`src/lib/og-cards.ts`](src/lib/og-cards.ts), and name it on the page's `pageHead({ card: { type: "<type>", … } })` (see [`src/lib/seo.ts`](src/lib/seo.ts)).

### Release availability

Leave `introduced` and `updated` unset when you create or edit a page. The fields are optional. An unset page has no badge or "Available since" line until it ships.

`pnpm docs:availability <stable-version>` is the sole writer of page-level `introduced` and `updated` metadata. It requires a clean working tree. It uses the net committed diff from the previous stable tag to `HEAD`. It assigns both fields to new pages automatically. It presents changed and moved pages in batches of at most five. Each batch starts with no page selected, so each `updated` value records an explicit material-change decision.

The command validates the complete write plan before it changes files. It shows the plan and asks for final confirmation once. Use `pnpm docs:availability <stable-version> --check` to run the same scan without prompts or writes. A successful write run tells you to review and commit its changes, then run `pnpm release` again.

For a stable Obsidian release, `release.ts` offers this command as a handoff before it changes any file. The release continues when you decline the handoff. Pre-release and Zotero-only releases continue without this prompt. The only docs data that `release.ts` writes is the Docs Release Line in `zotlit-release.json`.

Section Index pages have the basename `index.mdx`. They have no availability metadata and stay outside the scan. Generated pages and underscore-prefixed content partials also stay outside the scan. See [ADR 0002](docs/adr/0002-release-availability-is-git-diff-assisted-not-hand-authored.md) and the docs-availability implementation in the scripts workspace. The site derives `NEW` and `UPDATED` from the Docs Release Line.
