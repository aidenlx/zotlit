# 08 — In-vault shortcuts

Status: ready-for-agent
Blocked by: 05

## Parent

`.scratch/template-data-explorer/PRD.md`

## What to build

Two jump-in gestures, both through the shared open function (item reference + optional annotation key). A menu action on literature notes — "Explore template data" — opens the explorer at that note's item. A per-annotation action in the annotation sidebar view opens the explorer pre-anchored at that annotation. Wiring follows the plugin's existing action-module / menu-segment machinery.

## Acceptance criteria

- [ ] Literature-note menu action opens the explorer at that note's item
- [ ] Annot-view per-annotation action opens the explorer anchored at that annotation
- [ ] Both reuse the shared open function; no duplicated open logic
- [ ] Actions absent where they don't apply (non-literature notes)
- [ ] Strings localized, sentence case
