# 06 — Filter

Status: ready-for-agent
Blocked by: 02

## Parent

`.scratch/template-data-explorer/PRD.md`

## What to build

One filter box above the tree. Case-insensitive substring matching over property names and stringified primitive values — so `pageLabel` finds the field and "Smith" finds the creator holding it. Matches display highlighted with their ancestor chain auto-expanded; everything unmatched collapses away. Clearing the filter restores the user's own expansion state. No regex, fuzzy modes, or match-count chrome.

Matching and filter-driven expansion live in the pure display-tree module; this ticket adds the input UI and wires it.

## Acceptance criteria

- [ ] Filter matches key names and primitive values, case-insensitive substring
- [ ] Matches highlighted; ancestor chains auto-expanded; non-matching branches hidden
- [ ] Clearing the filter restores the pre-filter expansion state
- [ ] Works identically at Note Root and Annotation Root anchors
- [ ] Matching + expansion behavior covered by pure-module tests
