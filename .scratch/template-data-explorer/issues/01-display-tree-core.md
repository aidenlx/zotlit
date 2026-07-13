# 01 — Display-tree core: pure module + presentational tree components

Status: ready-for-agent
Blocked by: none

## Parent

`.scratch/template-data-explorer/PRD.md`

## What to build

The Template Data Explorer's heart, Obsidian-free: a pure display-tree module that maps (template data context, anchor, filter, expansion state) to typed display nodes, and the React tree components that render those nodes. A consumer hands the components nodes and callbacks; they hand back user intent (expand/collapse, node action requests). Nothing here knows about Obsidian.

Display-node vocabulary per the PRD: plain value, evaluated helper (with signature hint), inert placeholder. Path-string generation and filter matching belong to this module's contract but their user-facing features ship in later tickets — design the node/model shape so tickets 04 (copy paths) and 06 (filter box) extend rather than rework it.

## Acceptance criteria

- [ ] Pure module produces display nodes for a note-root context: plain values, arrays/objects with stable data-path keys, lazy-getter children materialized on expansion
- [ ] Expansion state is keyed by data path and owned by the caller (survives a rebuilt context)
- [ ] React tree components render display nodes, render only expanded children, and raise expansion + node-action callbacks
- [ ] Components import nothing from `obsidian` (props in, callbacks out)
- [ ] Pure-module behavior covered by unit tests (prior art: the annot-view resolve-target module test); React layer verified by typecheck only
- [ ] Styling uses Tailwind + Obsidian native tokens per the plugin's CSS conventions
