<!-- BEGIN:nextjs-agent-rules -->
 
# Next.js: ALWAYS read docs before coding
 
Before any Next.js work, find and read the relevant doc in `node_modules/next/dist/docs/`. Your training data is outdated — the docs are the source of truth.
 
<!-- END:nextjs-agent-rules -->

# Writing docs

End-user doc pages are authored by the `docs-writer` agent, which runs the `docs-writing` skill. When docs work comes up, scope the topic, verify the facts, and settle the content tree, then delegate the prose to `docs-writer` — don't self-author pages in the main thread. Author inline only for a tiny touch.

# Docs site design

The docs site's visual spec — "Manuscript & Machine" theme, the four-face type system (Gelasio serif / Inter sans / IBM Plex Mono / Archivo), `--color-fd-*` tokens, label voice, and the app-owned fumadocs layout slots — lives in [`DESIGN.md`](DESIGN.md). Read it before touching typography, prose styling, fonts, serif/sans font roles, font loading, theming, color tokens, `global.css`, chrome, or layout.

# Docs content components

Custom MDX components (`components/`) are imported per-page in the `.mdx`, not registered in `components/mdx.tsx`; wrap them in `not-prose` and style over `--color-fd-*` tokens (see `action-link.tsx`).

`<Command>` marks an Obsidian command-palette string, keeping the `ZotLit:` prefix — `<Command>` block or `<Command inline>` mid-sentence; menu items and labels stay `**bold**`. See `command.tsx` and `DESIGN.md`.

# Social (OG) images

Every page's `og:image` is a takumi-rendered 1200×630 card served by one dynamic route.

- `app/og/_render.tsx` — the card itself (Google Fonts + Tailwind `tw` styling); `ogImage(props)` returns the `ImageResponse`.
- `app/og/[...slug]/route.tsx` — maps a `[type, ...ids]` slug to a card; the `OgType` list + `assertNever` keep the switch exhaustive.
- `lib/shared.ts` — `ogImageUrl(type, ...ids)`, the URL a page's `metadata` points at.

Adding a page type: add its `case` (+ `OgType` entry + `generateStaticParams` seg) in the route, then set the page's metadata via `pageMetadata({ card: { type: "<type>", ... } })` (see `lib/seo.ts`).