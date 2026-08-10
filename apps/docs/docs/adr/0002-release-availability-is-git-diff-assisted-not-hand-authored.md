# Release availability is git-diff-assisted, not hand-authored

Docs pages no longer require `introduced`/`updated` frontmatter at authoring time; both fields are optional and default to unset (no sidebar badge, no "Available since" line — a normal, expected state for a page that hasn't shipped yet). At release time, a new `release.ts` phase diffs `content/docs/**/*.mdx` against the previous Stable Release Line git tag, with rename detection so a moved-but-recognizable page keeps its existing `introduced`. It classifies each page as new, moved, changed, or unchanged; auto-accepts new pages (`introduced = updated = next version`, no ambiguity to review); and for every moved or changed page, shows the reviewer an inline diff and asks before writing the accepted values into frontmatter. This keeps "Updated Release" true to its `CONTEXT.md` meaning — a material product change, not a raw diff — since a mechanical scan can find candidates but not judge material-vs-wording on its own; only a human looking at the actual diff can.

The current Docs Release Line is read from a new committed artifact, `apps/docs/zotlit-release.json`, written by the same release phase, instead of reaching into `apps/obsidian/package.json` directly.

## Considered options

- **Fully automatic, no review.** Derive `updated` straight from the diff with no human step. Rejected — a mechanical diff can't distinguish a typo fix from a feature change, and `CONTEXT.md`'s "wording corrections preserve this release history" rule depends on that distinction.
- **Mirror the version into `apps/docs/package.json#version`** instead of a dedicated file. Rejected — conflates two meanings under one already-meaningful field name (a private, unpublished package's own version vs. a copy of the Obsidian plugin's version) and creates a second source of truth with no built-in check against `apps/obsidian/package.json`.

## Consequences

- `apps/docs/zotlit-release.json` must exist before the first build under this design; it is seeded by hand once (`{ "version": "2.0.1" }`, the last real stable release), since `release.ts` only ever updates it, never creates it from nothing.
- `.vercelignore` no longer needs to reach into `apps/obsidian` at all.
