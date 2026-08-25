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

## Stack

- **TanStack Start** (SSR React) — `@tanstack/react-start`, `@tanstack/react-router`, file-based routing in `src/routes/`.
- **React 19.2** via Vite's built-in JSX transform.
- **Tailwind CSS v4** via `@tailwindcss/vite`; styles live in `src/styles.css`.
- **Vite 8** as the bundler.
- **Cloudflare Workers** as the server runtime — `@cloudflare/vite-plugin` wired in `vite.config.ts` with `viteEnvironment: { name: "ssr" }`. Worker config lives in `wrangler.jsonc`; the entry is `@tanstack/react-start/server-entry`.
- **Build output** in `dist/` — `dist/client` holds static assets, `dist/server` holds the Worker plus the generated `wrangler.json` that `wrangler deploy` reads.

