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
- `pnpm --filter @zotlit/website cf-typegen` — regenerate `worker-configuration.d.ts` after editing `wrangler.jsonc`.
- `pnpm --filter @zotlit/website exec fumadocs-mdx` — regenerate the `.source/` collection index; `postinstall` and `vite build` already run it.

## Content pipeline

- **Migration:** `@zotlit/docs` is the content source of truth until cutover; the cutover sync copies it into this package's `content/` directory.
- **Collections:** Read [`source.config.ts`](source.config.ts) before changing frontmatter, partial discovery, Markdown editions, or syntax highlighting. It owns those rules and the three collection schemas.
- **Dates:** Normalize publication dates to ISO days directly in [`source.config.ts`](source.config.ts); workerd lacks Temporal, so this schema is a package-scoped exception to [the Temporal policy](../../policies/temporal-dates.md).

## Routing

- **Server side:** [`src/lib/source.ts`](src/lib/source.ts) reads `collections/server` and stays server-only. Routes reach it through `createServerFn` handlers, which return JSON — a page's file path, its frontmatter, the sidebar tree.
- **MDX bodies:** compile through `collections/browser`. Each route builds a client loader with `createClientLoader`, calls `preload(path)` in its loader, and renders `getComponent(path)`. The table of contents rides with the compiled module, so it never crosses the server boundary.
- **Redirects and headers:** [`src/lib/v1-redirects.ts`](src/lib/v1-redirects.ts) owns the v1 permalink table; a Vite plugin in [`vite.config.ts`](vite.config.ts) renders it into `dist/client/_redirects` and `_headers`, which the Cloudflare asset layer answers without a Worker invocation.
- **Search:** [`src/routes/api/search.ts`](src/routes/api/search.ts) serves `/api/search` from `createFromSource` over the docs loader alone, so the changelog and the blog stay unindexed. Its only `createFileRoute` property is `server`, which keeps it out of the client route tree and out of any prerender pass. The dialog is the fumadocs default and needs no client wiring.
- **Pending slices:** the Markdown editions, SEO endpoints, request-time GitHub data, and the "Manuscript & Machine" styling land in later tickets of issue #846.

## Verification

- [`http.test.ts`](src/http.test.ts) is the primary seam: it serves `dist/` through workerd and asserts what a browser sees — page status, redirect targets, search results, asset headers. Run it through turbo so the build runs first.
- [`source.test.ts`](src/lib/source.test.ts) pins collection discovery, ordering, and normalized dates. [`gfm.test.ts`](src/lib/template-contract/gfm.test.ts) pins generated Markdown tables. [`v1-redirects.test.ts`](src/lib/v1-redirects.test.ts) pins the rendered rule files.

## Deployment

- The worker is named `zotlit-docs` and serves staging on workers.dev. `.github/workflows/website-staging.yml` deploys every push on `refactor/tanstack`; it needs the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets.
