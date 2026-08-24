# Release availability is git-diff-assisted, not hand-authored

Docs pages do not require `introduced` or `updated` frontmatter during authoring. Both fields are optional. An unset page has no sidebar badge or "Available since" line until it ships.

`pnpm docs:availability <stable-version>` is the sole writer of page-level availability metadata. It requires a clean working tree and a stable semantic version. It uses the net committed diff from the previous stable tag to `HEAD`. Rename detection lets a moved page keep its release history. A pure move needs no review. A moved page with content changes remains a review candidate.

The command assigns `introduced` and `updated` to new pages automatically. It shows diffs for changed and moved pages in stable batches of at most five. Each batch starts with no page selected. A selection records the reviewer's decision that the page contains a material product change. An unselected page keeps its existing release history.

The command collects all automatic edits and review selections before it writes. It validates the complete plan, shows one summary, and asks for final confirmation once. Cancellation leaves all content files unchanged. A repeat run skips pages already reviewed for the target Stable Release Line. The read-only `--check` mode uses the same discovery and validation path. It returns a nonzero status when candidates need action.

Section Index pages have the basename `index.mdx`. They carry no availability metadata and stay outside candidate discovery. Generated pages, underscore-prefixed content partials, and deleted pages also stay outside the write plan.

For a stable Obsidian target, `release.ts` asks whether to run the docs scan before its first file change. A positive answer prints `pnpm docs:availability <selected-stable-version>` and exits successfully. A negative answer continues the release. Pre-release Obsidian targets and Zotero-only targets continue without this handoff. After the docs changes are committed, the maintainer runs `pnpm release` again and continues the release.

`release.ts` retains the Docs Release Line responsibility. It writes the current line to the committed `apps/docs/zotlit-release.json` artifact. The docs site reads this artifact to resolve availability badges. Page-level availability belongs only to the separate docs-availability command.

## Considered options

- **Fully automatic, no review.** Derive `updated` straight from the diff with no human step. Rejected — a mechanical diff can't distinguish a typo fix from a feature change, and `CONTEXT.md`'s "wording corrections preserve this release history" rule depends on that distinction.
- **Mirror the version into `apps/docs/package.json#version`** instead of a dedicated file. Rejected — conflates two meanings under one already-meaningful field name (a private, unpublished package's own version vs. a copy of the Obsidian plugin's version) and creates a second source of truth with no built-in check against `apps/obsidian/package.json`.
- **Write page metadata during `pnpm release`.** This combines review with version changes. This option was rejected. The separate command uses a clean committed baseline and validates the complete plan before one final confirmation.

## Consequences

- `apps/docs/zotlit-release.json` must exist before the first build under this design; it is seeded by hand once (`{ "version": "2.0.1" }`, the last real stable release), since `release.ts` only ever updates it, never creates it from nothing.
- `.vercelignore` no longer needs to reach into `apps/obsidian` at all.
- Maintainers run and commit `pnpm docs:availability <stable-version>` before they continue a stable release.
- Section Index pages show no availability badge or availability row.
