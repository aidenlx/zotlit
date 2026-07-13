# 03 — Helper and placeholder node fidelity

Status: ready-for-agent
Blocked by: 02

## Parent

`.scratch/template-data-explorer/PRD.md`

## What to build

Full display fidelity for the contract's non-plain-data members. Link helpers (`noteLink`, `fileLink`, `imageLink`) display their evaluated zero-argument rendering plus a signature hint, so a template author sees what a link produces and whether its target resolves. Lazy parent getters (`parentItem`, `parentAttachment`) resolve when expanded. The two helpers that queue vault writes on first invocation resolve to their existing targets when the note/image is already imported, and to a clearly labeled "not imported" inert placeholder otherwise — never minting a path, never queueing work (ADR 0005).

## Acceptance criteria

- [ ] Safe link helpers show evaluated default rendering + signature hint
- [ ] Lazy getters resolve on node expansion and are fully explorable
- [ ] Child-note links: existing Imported Note target shown when one exists; labeled placeholder otherwise
- [ ] Excerpt-image links: existing in-vault target shown when already imported; labeled placeholder otherwise
- [ ] Resolver-seam tests assert zero import/queue calls across a full browse of an item with unimported notes and excerpt images
- [ ] Displayed evaluated output matches what a real render would produce for already-resolved targets
