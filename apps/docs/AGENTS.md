<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# @zotlit/docs

Documentation and landing site, built with Next.js + Fumadocs.

## Commands

Run `build` / `test` / `lint` via turbo (see root AGENTS.md → Commands). Package-specific:

- `pnpm --filter @zotlit/docs dev` — local dev server.
- `pnpm --filter @zotlit/docs codegen` — regenerate Fumadocs MDX types.
- `pnpm exec turbo run generate:template-data --filter=@zotlit/docs` — regenerate the template-data reference page.

## Generated template-data reference

`content/docs/reference/templates/data.mdx` is generated from the `zt` type comments in `packages/db/src/lib/context/`. Edit those comments, run `pnpm --filter @zotlit/db generate:contract`, then run the Turbo task above.

`lib/template-contract/sections.ts` owns the section structure. The `_*.mdx` partials beside the generated page own supplementary prose.

The page's Markdown edition renders each `<ContractTable>` as a GFM table through the `stringify` callback on the docs collection's `includeProcessedMarkdown` in `source.config.ts`.

## Content & writing docs

Content lives in `content/`; collections and schemas are defined in `source.config.ts`. `content/docs/` follows Diataxis. 

Read `/docs-writing` to scope content decisions, then delegate prose to the `docs-writer` agent.

Image attachments (screenshots, etc.) go under `public/img/<collection>/` as `.webp`, not `.png`/`.jpg` — convert with `cwebp` before committing.

# Docs site design

The docs site's visual spec — "Manuscript & Machine" theme, the four-face type system (Gelasio serif / Inter sans / IBM Plex Mono / Archivo), `--color-fd-*` tokens, label voice, and the app-owned fumadocs layout slots — lives in [`DESIGN.md`](DESIGN.md). Read it before touching typography, prose styling, fonts, serif/sans font roles, font loading, theming, color tokens, `global.css`, chrome, or layout.

# Docs content components

Custom MDX components (`components/`) are imported per-page in the `.mdx`, not registered in `components/mdx.tsx`; wrap them in `not-prose` and style over `--color-fd-*` tokens (see `action-link.tsx`).

`<Command>` marks an Obsidian command-palette string, keeping the `ZotLit:` prefix — `<Command>` block or `<Command inline>` mid-sentence; menu items and labels stay `**bold**`. See `command.tsx` and `DESIGN.md`.

# Deep-linkable heading anchors

Give any heading that is a deep-link target (linked from another page, a changelog entry, or an issue reply as `/path#anchor`) a stable custom anchor via fumadocs' `[#slug]` syntax, e.g. `## Section title [#bulk]`. The auto-generated slug tracks the heading text, so rewording it silently breaks inbound links; a short custom id does not. Reference: https://www.fumadocs.dev/docs/markdown#toc-settings

# Social (OG) images

Adding a page type: add its `case` (+ `OgType` entry + `generateStaticParams` seg) in `app/og/[...slug]/route.tsx`, then set the page's metadata via `pageMetadata({ card: { type: "<type>", ... } })` (see `lib/seo.ts`).