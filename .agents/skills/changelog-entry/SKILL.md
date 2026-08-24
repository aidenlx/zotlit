---
name: changelog-entry
description: Write a user-facing changelog entry under apps/docs/content/changelog/. Use when the user asks to "write the changelog", "draft changelog for v...", "add changelog entry", "document this release", or after a batch of obsidian/zotero fixes has landed and they want end-user release notes. Derives content from git history, filtering to user-observable changes only.
---

# Changelog entry for apps/docs

Writes a new file at `apps/docs/content/changelog/<version>.mdx` describing user-visible changes since the last release.

The reader is an Obsidian plugin user who integrates Zotero. They care what changed for *them*, not how it was implemented. Prose is authored by the `docs-writer` agent following the `docs-writing` skill — scope the content, then delegate the writing.

## Optional context slot

If `$ARGUMENTS` is provided, treat it as authoritative additional context that overrides defaults. Common uses:

- a target version (`v2.0.0-beta.3`, `2.1.0`)
- items to emphasize, downplay, or reword
- missing context the commit messages do not capture
- explicit grouping hints

## Steps

### 1. Decide the version

Pick the version in this order:

1. If `$ARGUMENTS` names one, use it. Strip a leading `v` for frontmatter; keep it in the filename.
2. Otherwise read `apps/obsidian/package.json` `version`. If `apps/docs/content/changelog/<version>.mdx` does not yet exist, that is the version.
3. Otherwise the version is already documented and `package.json` has not been bumped. Stop and ask.

The filename tracks the **Obsidian plugin** version. The Zotero companion version goes in the `companion` frontmatter field when it ships alongside.

### 2. Pick today's date

Use today's local date as `YYYY-MM-DD`. Do not derive it from commit timestamps.

### 3. Read git history

Find the previous release commit:

```bash
git log --oneline --grep='^chore: release obsidian@' -1
```

Take that commit's hash as `<cutoff>`, then:

```bash
git log <cutoff>..HEAD --no-merges --oneline -- apps/obsidian apps/zotero packages/
```

Read commit bodies for user-impact detail when subjects are terse. If the body is empty, skim the diff to understand what the user sees differently.

### 4. Filter to user-observable changes

Most commits get dropped. That is correct.

**Include:**

- `feat(obsidian|zotero|annot-view|note|batch|...)` that adds a command, setting, UI element, or observable behavior
- `fix(...)` for bugs the user could actually hit (broken view, wrong data, stuck UI, crash)
- `feat!` / `fix!` breaking changes — always, under `## Breaking Changes`
- Template data changes (`feat(db)`) when they add or rename a `zt.*` variable the user writes in templates
- Zotero companion changes only when the plugin user perceives them (new columns, menu items, reader behavior)

**Exclude:**

- `chore:` — version bumps, dependency updates, CI, release commits, skill/agent updates
- `refactor:` — unless the user can perceive the difference
- `fix(...)` for a feature new in this release — the broken state never shipped
- `test:`, `docs(agents)`, internal logging, dev-only tooling, type-only changes
- `build:`, `ci:`, `perf:` that only affect build speed or developer experience
- Commits whose user-facing effect is already covered by a later commit in the same range

### 5. Surface test

Walk every sentence in the draft and ask: *would a user who has never read source code understand this without skipping a word?*

Strip: class names, function names, API internals (`AsyncLocalStorage`, `MessageChannel`), return types (`null`), storage mechanisms (`synced plugin settings`, `localStorage`), internal decision logic ("the plugin decides whether to...").

Keep: setting names the user sees in the UI, command palette names, template variables (`zt.weblink`), Obsidian/Zotero version numbers when they bound the fix.

### 6. Group by user-facing category

Use these section headings, in this order. Omit empty ones.

```
## Highlights         (only for genuinely landmark features)
## Breaking Changes
## What's New
## Bug Fixes
```

Substantial features get `###` subheadings. Minor improvements collect under `### Other improvements` as bullets.

Bug fixes explain symptom then corrected behavior, not internal cause:
- "Fixed the annotation view not following a Zotero reader opened in its own window. Only tabbed readers were tracked before; standalone reader windows are now picked up on focus."

### 7. Link docs inline

When a feature has a dedicated guide or reference page, link it inline at the point where the feature is introduced. Do not collect doc links into a separate `## Documentation` section. A standalone documentation heading is justified only when the documentation itself is the news (e.g. a docs site launch) — and even then it goes under `## What's New` as a `###` subheading, not a top-level section.

Read 2–3 recent entries from `apps/docs/content/changelog/` to match tone before writing.

### 8. Write the entry

Frontmatter:

```yaml
---
version: "<exact version, no leading v>"
companion: "<zotero companion version, omit if none>"
date: "<YYYY-MM-DD>"
description: "<short phrase for the changelog list heading>"
---
```

All values must be **quoted strings**. The `description` becomes the clickable heading text on the changelog list page — keep it to a comma-separated list of the top 2–3 changes (e.g. "Per-device Zotero paths, web library links, reader window fix").

Write to `apps/docs/content/changelog/<version>.mdx`. Do not modify other changelog files.

Print the resulting path back to the user.

### 9. Slop check

Load the `slop-check` skill and run it on the finished file. Fix high- and medium-severity flags. Re-run until clean.

## Out of scope

- Bumping versions in `package.json`.
- Writing the blog post that accompanies major releases (those live under `apps/docs/content/blog/`).
- Pushing tags or creating GitHub releases.
- Modifying the changelog list page or its routing.
