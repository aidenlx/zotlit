# 09 — Zotero round trip: `explore` protocol action

Status: ready-for-agent
Blocked by: 05

## Parent

`.scratch/template-data-explorer/PRD.md`

## What to build

From Zotero to the explorer in one click. A new `explore` action in the protocol package (item parameter plus optional annotation parameter, following the existing actions' validation and source-id conventions). The Obsidian plugin registers the handler, which resolves the target and calls the shared open function — anchored at the annotation when one is given; unknown item or invalid query produces a Notice and a logged warning, matching existing handlers. The Zotero companion adds context-menu entries to its existing item menu and reader-annotation menu that send the URL.

## Acceptance criteria

- [ ] `explore` action defined in the protocol package with encode/decode/validation tests beside the existing URL tests
- [ ] Obsidian handler opens the explorer at the item, or anchored at the annotation when given
- [ ] Invalid/unknown-item URLs → Notice + logged warning
- [ ] Hand-crafted `obsidian://` explore URLs work without the companion
- [ ] Companion item-menu entry opens the explorer for the selected item
- [ ] Companion reader-annotation entry opens the explorer anchored at that annotation
- [ ] Companion strings via Fluent; plugin strings via Paraglide
