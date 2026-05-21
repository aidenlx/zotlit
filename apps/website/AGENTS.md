<!-- intent-skills:start -->
## Skill Loading

Before substantial work:
- Skill check: run `pnpm dlx @tanstack/intent@latest list`, or use skills already listed in context.
- Skill guidance: if one local skill clearly matches the task, run `pnpm dlx @tanstack/intent@latest load <package>#<skill>` and follow the returned `SKILL.md`.
- Monorepos: when working across packages, run the skill check from the workspace root and prefer the local skill for the package being changed.
- Multiple matches: prefer the most specific local skill for the package or concern you are changing; load additional skills only when the task spans multiple packages or concerns.
<!-- intent-skills:end -->

# @zotlit/website

## Stack

- **TanStack Start** (SSR React) — `@tanstack/react-start`, `@tanstack/react-router`, file-based routing in `src/routes/`.
- **React 19.2** via Vite's built-in JSX transform.
- **Tailwind CSS v4** via `@tailwindcss/vite`; styles live in `src/styles.css`.
- **Vite 8** as the bundler.
- **Nitro 3** as the server runtime — `nitro/vite` plugin wired in `vite.config.ts`. Builds emit `.output/server/index.mjs`.

