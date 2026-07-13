# 04 — Copy affordances

Status: ready-for-agent
Blocked by: 02

## Parent

`.scratch/template-data-explorer/PRD.md`

## What to build

The authoring loop's payoff, split by how often each action is reached. Copy value — the common debugging action — is a one-click hover/focus button on each row (checkmark flash on success), yielding the node's current value (strings as-is, objects as JSON). Copy path lives in a per-row template-actions menu button: the bare Liquid data path (`zt.…`, array indices included) — paste-correct in both interpolations and `{% for %}` tags. While JavaScript Templates is enabled on the device, that menu lists both variants explicitly — "Copy Liquid path (`zt.…`)" and "Copy Eta path (`it.…`)"; while off, only the Liquid copy exists.

Path-string generation lives in the pure display-tree module with tests; the shell wires the row button, the Obsidian menu, and the clipboard, with node-action requests raised through the ticket-01 component callbacks.

## Acceptance criteria

- [ ] Copy value is a one-click per-row hover/focus button with success feedback
- [ ] Per-row template-actions menu offers copy path
- [ ] Copied Liquid paths are `zt`-rooted with array indices and paste correctly into tags and interpolations
- [ ] JavaScript Templates on → both Liquid and Eta variants listed explicitly; off → no Eta entry anywhere
- [ ] Copy value: primitives verbatim, objects/arrays as JSON
- [ ] Path generation covered by pure-module tests, including the flag-gated Eta variant
- [ ] Menu strings localized, sentence case
