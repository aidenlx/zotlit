# 05 — Annotation Root

Status: ready-for-agent
Blocked by: 04

## Parent

`.scratch/template-data-explorer/PRD.md`

## What to build

Re-anchoring: every annotation node in the Note Root tree offers "Explore as annotation template data", which re-anchors the tree at that annotation — exactly the shape the `annotation` template receives as `zt`. Copy paths re-root at the annotation (`zt.comment`, not `zt.annotations[3].comment`). A breadcrumb/back control returns to the Note Root. The anchor (annotation key) persists in view state alongside the item and restores with the workspace.

## Acceptance criteria

- [ ] Annotation nodes offer the re-anchor action; choosing it anchors the tree at that annotation
- [ ] Anchored tree shows the annotation's fields at the root, including parent getters
- [ ] Copy paths from an Annotation Root are annotation-rooted (both language variants)
- [ ] Breadcrumb/back returns to the Note Root
- [ ] Anchor persists in view state and restores with the workspace
- [ ] Re-anchoring and path re-rooting covered by pure-module tests
