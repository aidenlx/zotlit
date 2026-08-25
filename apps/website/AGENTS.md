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
- **Routing cutover:** Add `collections/server` to the production module graph with the routing shell and `fumadocs-ui` components that compile the MDX imports.
- **Collections:** Read [`source.config.ts`](source.config.ts) before changing frontmatter, partial discovery, Markdown editions, or syntax highlighting. It owns those rules and the three collection schemas.
- **Dates:** Normalize publication dates to ISO days directly in [`source.config.ts`](source.config.ts); workerd lacks Temporal, so this schema is a package-scoped exception to [the Temporal policy](../../policies/temporal-dates.md).
- **Verification:** [`source.test.ts`](src/lib/source.test.ts) pins collection discovery, ordering, and normalized dates. [`gfm.test.ts`](src/lib/template-contract/gfm.test.ts) pins generated Markdown tables.
