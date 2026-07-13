# 10 — Per-engine template snippets

Type: task
Status: resolved
Blocked by: 04

## Parent

`.scratch/template-data-explorer/PRD.md`

## What to build

The per-row template-actions menu gains paste-ready **Template Snippets** alongside the shared `zt.…` copy-path. The bare path is engine-neutral but not a complete fragment; snippets wrap it in an engine's delimiters and diverge where Liquid and Eta differ.

Four kinds, gated by node kind:

- **Copy output** — interpolation. Scalars/objects/getters/helpers. Liquid auto-invokes a helper (`{{ zt.fileLink }}`); Eta calls it (`<%= zt.fileLink() %>`).
- **Copy if present** — truthiness guard around the output, for suppressing surrounding content (plain output is already empty-safe via `coerceOutput`). Same node kinds as output.
- **Copy loop** — array iteration; element variable is the array key singularized (`tags`→`tag`), falling back to `item`.
- **Copy joined** — array flattened with `, `; offered only when elements stringify meaningfully (primitive or own `toString`), never for plain-object arrays.

Menu surface: Liquid snippets sit inline while JavaScript Templates is off; once enabled, snippets split into `Liquid` / `Eta` submenus. The Eta gate (`TemplateService.javascriptTemplatesEnabled`) is read live per menu-open.

Snippet generation is a pure `(node, engine, kind) → string` module (`snippets.ts`) with its own tests, mirroring the `display-tree.ts` split. Decision recorded in ADR 0008; glossary term "Template Snippet" in `apps/obsidian/CONTEXT.md`.

## Acceptance criteria

- [x] Each node offers copy output + if-present; arrays offer loop + joined (joined gated on element stringifiability)
- [x] Helper/placeholder output uses Liquid auto-invoke vs explicit Eta call
- [x] Loop element variable singularizes the array key, falling back to `item`
- [x] Eta snippets appear only when JavaScript Templates is enabled; Liquid inline when alone, submenus when both
- [x] Snippet strings covered by pure-module tests across engine × kind × node kind
- [x] Menu strings localized, sentence case
