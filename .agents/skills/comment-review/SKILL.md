---
name: comment-review
description: |
  Reviews and fixes comments in staged git changes against this project's
  AGENTS.md comment conventions. Scans `git diff --cached`, identifies
  violations in added lines, and applies surgical edits to the affected files.
  Use this skill whenever the user asks to "review comments", "scan staged
  changes comments", "check comments against AGENTS.md", "improve comments",
  or similar. Also invoke proactively after implementing a feature when the
  user asks for a comment quality pass.
---

Full conventions live in **AGENTS.md → Comments**. This skill operationalises
them into a review workflow.

## Workflow

1. Run `git diff --cached`. If output exceeds ~30 KB, save to the scratchpad and read from there.
2. Scan only **added lines** (`+` prefix, excluding `+++` headers) for violations.
3. For each file with violations, read the full source file to get accurate line numbers.
4. Apply fixes with the Edit tool — touch only the comment, not surrounding code.
5. Print a one-line-per-fix report at the end (see Output format below).

## Checklist

| Find in added lines | Fix |
|---|---|
| "Returns X" / "Returns `Y` when …" in prose | Convert to `@returns` tag |
| "Defaults to X" in prose | Convert to `@default X` tag |
| JSDoc that only restates the name, type, or implementation | Drop it |
| Comment referencing the task, PR, or caller ("used by X", "for issue #123") | Drop it |
| New file (non-barrel, not `index.ts`) with no `//` comment on line 1 | Add one-sentence module comment |

**Trim, don't drop** mixed JSDoc: if a block has one restating sentence and one non-obvious sentence, delete only the restating part.

**Preserve** without touching:
- Comments explaining a non-obvious WHY: hidden constraints, data-model quirks, subtle invariants.
- Lifecycle / usage guidance on classes ("Hold one instance across a batch").
- Test-data setup comments that explain why fixtures look unusual.
- `@see` tags themselves.

## Surgical-changes rule

Only fix lines **introduced in this diff**. If a pre-existing unchanged line has a `{@link}` pattern, leave it alone — match its style in adjacent new lines you do touch.

## Output format

```
packages/db/src/lib/zt-collection.ts:159  prose "Returns…" → @returns tag
apps/obsidian/src/services/note-feature/context.ts:87  dropped restatement on fetchItemCollections
```

If nothing needed fixing, say "No comment violations found in staged changes."
