# Prototype: the ZotLit Query CLI redesign

Throwaway. Design question: can one `zotlit:query` command with `from=items|attachments|annotations` and Relation Lists in both directions answer SQL-style cross-entity research questions, while the argument form stays as simple as an Obsidian Bases view?

- `prototype-query-cli.html` — double-click to open. Free play, seven walkthroughs, and a 28-question evaluation that runs the version-2 contract and the proposal on the same sample Library.
- `report-query-cli-redesign.html` — the design report (Chinese) with the ten proposals as diffs and the evaluation numbers.
- `engine.mjs` — the pure query module (both CLI shapes, the expression evaluator, projection paths, group, diagnostics, output formats). No DOM.
- `data.mjs` — the sample Library: two Libraries, 11 Items, 11 Attachments, 16 Annotations.
- `cases.mjs` — the 28 research questions; `scenarios.mjs` — the walkthroughs.
- `prototype-shell.html` + `node assemble.mjs` — rebuilds `prototype-query-cli.html` by inlining the modules.

Answer: yes. 26 of 28 questions in one call (the other two are two steps by nature); the version-2 contract answered 11 in one call, needed caller-side work for 11, and could not ask 4. Quote characters in the arguments fell from 354 to 134 over the 24 shared cases. Decisions recorded in ADR 0071; deferred: `format=`, a saved query file, `search=`, relation-derived sort keys.
