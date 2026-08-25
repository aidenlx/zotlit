<!-- intent-skills:start -->
## Skill Loading

Before editing files for a substantial task:
- Run `pnpm dlx @tanstack/intent@latest list` from the workspace root to see available local skills.
- If a listed skill matches the task, run `pnpm dlx @tanstack/intent@latest load <package>#<skill>` before changing files.
- Use the loaded `SKILL.md` guidance while making the change.
- Monorepos: when working across packages, run the skill check from the workspace root and prefer the local skill for the package being changed.
- Multiple matches: prefer the most specific local skill for the package or concern you are changing; load additional skills only when the task spans multiple packages or concerns.
<!-- intent-skills:end -->

# @zotlit/website

ZotLit documentation site — TanStack Start (SSR React) + Tailwind CSS v4, deployed to Cloudflare Workers.

## Commands

Run `build` / `test` / `lint` via turbo (see root AGENTS.md → Commands). Package-specific:

- `pnpm --filter @zotlit/website dev` — Vite dev server.
- `pnpm --filter @zotlit/website preview` — serve the built Worker locally through workerd.
- `pnpm --filter @zotlit/website deploy` — build, then `wrangler deploy` to Cloudflare Workers.
- `pnpm --filter @zotlit/website deploy:beta` — the same for Pre-release Docs. `CLOUDFLARE_ENV` picks the Cloudflare environment at build time, so the beta build has to be its own; a build made without it carries the production line's variables whatever `wrangler deploy --env` says.
- `pnpm --filter @zotlit/website cf-typegen` — write `worker-configuration.d.ts` to read the generated shape of a binding. The file stays ignored and out of `tsconfig.app.json`; the binding and variables the site actually reads are declared by hand in [`src/cloudflare-workers.d.ts`](src/cloudflare-workers.d.ts).
- `pnpm --filter @zotlit/website exec fumadocs-mdx` — regenerate the `.source/` collection index; `postinstall` and `vite build` already run it.

## Content pipeline

- **Migration:** `@zotlit/docs` is the content source of truth until cutover; the cutover sync copies it into this package's `content/` directory.
- **Collections:** Read [`source.config.ts`](source.config.ts) before changing frontmatter, partial discovery, Markdown editions, or syntax highlighting. It owns those rules and the three collection schemas.
- **Dates:** `publishedOn` in [`src/lib/shared.ts`](src/lib/shared.ts) normalizes every publication date to an ISO day, for both the collections and the build-time content scan; workerd lacks Temporal, so this schema, the reader-facing date helpers beside it — the two release-date formatters and the footer's copyright year — and the `Date` the `feed` library takes in [`src/routes/changelog/rss[.]xml.ts`](<src/routes/changelog/rss[.]xml.ts>) are a package-scoped exception to [the Temporal policy](../../policies/temporal-dates.md).

## Routing

- **Server side:** [`src/lib/source.ts`](src/lib/source.ts) reads `collections/server` and stays server-only. Routes reach it through `createServerFn` handlers, which return JSON — a page's file path, its frontmatter, the sidebar tree.
- **MDX bodies:** compile through `collections/browser`. Each route builds a client loader with `createClientLoader`, calls `preload(path)` in its loader, and renders `getComponent(path)`. The table of contents rides with the compiled module, so it never crosses the server boundary.
- **Redirects and headers:** [`src/lib/v1-redirects.ts`](src/lib/v1-redirects.ts) owns the v1 permalink table; a Vite plugin in [`vite.config.ts`](vite.config.ts) renders it into `dist/client/_redirects` and `_headers`, which the Cloudflare asset layer answers without a Worker invocation.
- **Search:** [`src/routes/api/search.ts`](src/routes/api/search.ts) serves `/api/search` from `createFromSource` over the docs loader alone, so the changelog and the blog stay unindexed. Its only `createFileRoute` property is `server`, which keeps it out of the client route tree and out of any prerender pass. The dialog is the fumadocs default and needs no client wiring.
- **Markdown editions:** every page publishes its authored Markdown at two URLs — `<page>.md` and `/llms.mdx/<section>/…/content.md`. [`src/lib/markdown-routes.ts`](src/lib/markdown-routes.ts) owns that scheme; the `rewrite` in [`src/router.tsx`](src/router.tsx) folds the `.md` suffix onto the content route, so [`src/routes/llms[.]mdx/$.ts`](<src/routes/llms[.]mdx/$.ts>) answers both. Bodies and the two `llms*.txt` indexes come from [`src/lib/markdown-editions.ts`](src/lib/markdown-editions.ts).
- **Prerendering:** [`src/lib/prerender-pages.ts`](src/lib/prerender-pages.ts) lists every route `tanstackStart({ pages })` writes into the client output — the Markdown surface, the SEO endpoints, and each HTML page whose body is settled at build time. Vite loads its config outside the app's module graph, so the content half of that list comes from [`src/lib/content-scan.ts`](src/lib/content-scan.ts), which reads the content directory instead of the collections. Automatic discovery stays off. What the list leaves out renders on the Worker, and each omission is deliberate: the landing and community pages and the two install pages carry request-time GitHub data, and the per-version changelog page carries the Pre-release Docs fallback. [ADR 0025](../../docs/adr/0025-the-docs-site-prerenders-asset-first-and-falls-through-to-an-ssr-worker.md) explains the shape.
- **Negotiation:** [`src/server.ts`](src/server.ts) is the Worker's entry — it wraps the default TanStack Start handler, so `wrangler.jsonc` points `main` at it. `run_worker_first` puts the Worker ahead of the asset layer on the HTML page paths alone; there it applies fumadocs' `isMarkdownPreferred` and rewrites the path with `negotiatedContentRoute` from [`src/lib/markdown-routes.ts`](src/lib/markdown-routes.ts), then hands the request to the `ASSETS` binding and falls through to SSR only when no file answers. The asset call keeps `redirect: "manual"`, so a `_redirects` rule still reaches the reader as its own redirect.
- **Pre-release Docs fallback:** a changelog version absent from the build 307s to the beta line — the page ([`src/routes/_home/changelog/$version.tsx`](<src/routes/_home/changelog/$version.tsx>)), its Markdown edition, and its OG card ([`src/routes/og/$.ts`](<src/routes/og/$.ts>)) each hand on their own path through [`src/lib/beta-fallback.ts`](src/lib/beta-fallback.ts). The gate is the `DOCS_LINE` Worker variable: Pre-release Docs sets it to `beta` and answers 404 instead of redirecting to itself.
- **GitHub data:** [`src/lib/release-data.ts`](src/lib/release-data.ts) fetches the install pages' Version Ledger and `.xpi` link plus the landing and community counters, each cached about an hour at the edge and each failing soft — a page loses its ledger or its counters, never itself. The `GITHUB_TOKEN` Worker secret raises the API rate limit. The MDX components sit far below their route, so the snapshot reaches them through [`src/components/release-snapshot.tsx`](src/components/release-snapshot.tsx) rather than as props.
- **Client-side widgets:** [`src/components/redirect-notice.tsx`](src/components/redirect-notice.tsx) reads the `?from=v1` / `?lang=zh-CN` query contract after mount, since the pages it sits on are prerendered without a query; [`src/components/comments.tsx`](src/components/comments.tsx) mounts giscus on a blog post, keyed on the post's path.
- **Pending slices:** the docs-availability preamble (`_Available since ZotLit …_`) and its sidebar pill arrive with the availability port, [issue #857](https://github.com/aidenlx/zotlit/issues/857); [`src/layouts/docs/slots/sidebar.tsx`](src/layouts/docs/slots/sidebar.tsx) marks where the pill goes.

## Styling

The site wears the "Manuscript & Machine" design. Its spec — theme, the four-face type system, label voice, per-surface notes, and the CSS architecture rule — is [`../docs/DESIGN.md`](../docs/DESIGN.md), which the cutover moves into this package along with the content. Read it before touching typography, fonts, theming, color tokens, chrome, or layout.

- **Tokens:** [`src/styles.css`](src/styles.css) holds the whole CSS layer — the `--color-fd-*` palette for both schemes, the `@theme inline` font wiring, the `#toc-title` anchor, and the scrollbar rules. Prose styling stays out of it: [`src/lib/prose.ts`](src/lib/prose.ts) expresses the docs/blog body (`ztProse`) and the changelog type roles (`changelogProseRoles`) as typography element modifiers, which each surface applies inline.
- **Fonts:** Fontsource serves all four faces from this package's own assets. The `@import`s in `src/styles.css` register them; `--font-sans` / `--font-serif` / `--font-mono` / `--font-brand` in the same file assign the roles. [`src/routes/__root.tsx`](src/routes/__root.tsx) preloads Gelasio's two latin faces, upright and italic, since serif display paints on essentially every route; Inter and IBM Plex Mono swap in from a system fallback instead. The Archivo wordmark subset needs no preload — it is under Vite's `assetsInlineLimit`, so the build inlines it into the stylesheet.
- **Owned layout slots:** `src/layouts/` vendors three fumadocs slots — [home header](src/layouts/home/slots/header.tsx), [docs sidebar](src/layouts/docs/slots/sidebar.tsx), and [docs page footer](src/layouts/docs/page/slots/footer.tsx) — plus [`src/components/banner.tsx`](src/components/banner.tsx), whose `height` is a floor so the strip wraps rather than overflows. Each vendors only its own file and imports everything else from package entry points, so a fumadocs bump means re-diffing four files. [`src/components/docs-subnav.tsx`](src/components/docs-subnav.tsx) wraps the packaged docs header for the mobile double-hairline instead of vendoring it.

## SEO and machine endpoints

- **Page head:** [`src/lib/seo.ts`](src/lib/seo.ts) builds one route `head` fragment — title, description, canonical, OpenGraph, Twitter, and the page's JSON-LD. [`src/routes/__root.tsx`](src/routes/__root.tsx) carries the site-wide defaults; TanStack merges head tags by `name`/`property`, so a page names only what differs. The schema.org objects come from [`src/lib/structured-data.ts`](src/lib/structured-data.ts).
- **Sitemap:** [`src/lib/sitemap.ts`](src/lib/sitemap.ts) keys its table off `FileRouteTypes["to"]` minus a named list of machine routes. A new page route leaves a `Record` key missing and fails the typecheck; a new machine route fails the `satisfies` instead.
- **Binary assets:** the OG cards ([`src/lib/og-card.tsx`](src/lib/og-card.tsx), [`src/lib/og-cards.ts`](src/lib/og-cards.ts)) and the agent-skill archives ([`src/lib/agent-skills.ts`](src/lib/agent-skills.ts)) are emitted by the `machineAssets` plugin in [`vite.config.ts`](vite.config.ts), which also serves them in dev. They skip the prerender pass because it writes every response as text, and they need Node — takumi renders natively and the archives read the workspace. Archive URLs pin to the build's commit.

## Verification

- [`http.test.ts`](src/http.test.ts) is the primary seam: it serves `dist/` through workerd and asserts what a browser sees — page status, redirect targets, Accept-header negotiation, the Pre-release Docs fallback on both lines, which routes carry a prerendered file, Markdown editions, search results, sitemap and robots content, feed items, OG card content types, agent-skill digests, JSON-LD, and asset headers. It walks the page list from the loaders, so a page the prerender scan or the card scan misses fails there. Run it through turbo so the build runs first.
- [`source.test.ts`](src/lib/source.test.ts) pins collection discovery, ordering, and normalized dates. [`gfm.test.ts`](src/lib/template-contract/gfm.test.ts) pins generated Markdown tables. [`v1-redirects.test.ts`](src/lib/v1-redirects.test.ts) pins the rendered rule files.

## Deployment

- The worker is named `zotlit-docs` and serves staging on workers.dev. `.github/workflows/website-staging.yml` deploys every push on `refactor/tanstack`; it needs the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets.
- The `beta` environment deploys as `zotlit-docs-beta`, the Pre-release Docs line, with `DOCS_LINE` set to `beta`. The same workflow deploys it from `next`, the pre-release branch; the branch picks the wrangler environment for both the build and the deploy.
- Two values come from outside the repo: the `GITHUB_TOKEN` Worker secret (`wrangler secret put GITHUB_TOKEN`, per environment) and `VITE_CF_BEACON_TOKEN`, the public Cloudflare Web Analytics site token read at build time. Without the beacon token the site serves no analytics script.
