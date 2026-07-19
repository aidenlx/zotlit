<!-- BEGIN:nextjs-agent-rules -->
 
# Next.js: ALWAYS read docs before coding
 
Before any Next.js work, find and read the relevant doc in `node_modules/next/dist/docs/`. Your training data is outdated — the docs are the source of truth.
 
<!-- END:nextjs-agent-rules -->

# Docs content components

Custom MDX components (`components/`) are imported per-page in the `.mdx`, not registered in `components/mdx.tsx`; wrap them in `not-prose` and style over `--color-fd-*` tokens (see `action-link.tsx`).

`<Command>` marks an Obsidian command-palette string, keeping the `ZotLit:` prefix — `<Command>` block or `<Command inline>` mid-sentence; menu items and labels stay `**bold**`. See `command.tsx` and `DESIGN.md`.