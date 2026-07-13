# 07 — Live freshness

Status: ready-for-agent
Blocked by: 05

## Parent

`.scratch/template-data-explorer/PRD.md`

## What to build

The tree stays true to the Zotero database. On the database service's `changed` event, the current item's context refetches; tree expansion (keyed by data path) and the annotation anchor survive the refetch. If the item vanished, an explicit "item no longer in library" state replaces the tree (the item reference stays in view state so a later restore can retry). If only the anchored annotation vanished, the view falls back silently to the Note Root. The standard refresh action appears in the view menu, delegating to the database refresh like the annot view does.

## Acceptance criteria

- [ ] Database `changed` → context refetches; edits made in Zotero appear without re-picking
- [ ] Expansion state and annotation anchor survive a refetch
- [ ] Vanished item → explicit "no longer in library" state, item reference retained
- [ ] Vanished anchor → silent fallback to Note Root
- [ ] Refresh action present in the view menu, consistent with the annot view
- [ ] Expansion-preservation-across-refetch covered by pure-module tests
