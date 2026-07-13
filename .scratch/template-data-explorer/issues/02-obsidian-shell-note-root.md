# 02 — Obsidian shell: note-root tree end to end

Status: ready-for-agent
Blocked by: 01

## Parent

`.scratch/template-data-explorer/PRD.md`

## What to build

The tracer bullet: "Open template data explorer" in the palette reveals (or creates) the view in the right sidebar; the user picks a library item via the existing fuzzy item search — seeded from the active literature note's item on first open — and browses that item's real note-root template data as an expand/collapse tree.

The view follows the annot-view conventions (per-instance store, register module, command) and acts as a thin adapter over the ticket-01 components. The context is assembled through a minimal inert resolver set implementing the existing note/annotation resolver interfaces: side-effect-free helpers evaluated, the two import-queueing helpers (excerpt-image link, child-note link) always shown as placeholders for now — full fidelity is ticket 03. Per ADR 0005, browsing must never write to the vault.

## Acceptance criteria

- [ ] Palette command opens/reveals the view in the right sidebar
- [ ] Fresh view with no item shows a single "Choose item" call to action opening the picker
- [ ] First open seeds from the active literature note's item when there is one
- [ ] Picked item's note-root context renders as an explorable tree with real data
- [ ] Database-not-ready state matches the annot-view treatment
- [ ] Chosen item persists in view state and restores with the workspace
- [ ] Inert resolver tests over the test-fixture schema assert values are correct and no import work is ever queued
- [ ] All UI strings via Paraglide, Obsidian sentence case
