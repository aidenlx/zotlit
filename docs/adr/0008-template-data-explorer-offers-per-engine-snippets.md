# Template Data Explorer offers per-engine snippets alongside the shared copy-path

ADR 0004 §11 established that the Template Data Explorer offers exactly one `zt.…` copy-path regardless of the JavaScript Templates gate, because the bare accessor is valid member-access in both Liquid and Eta. That copy-path stays, unchanged and always shared — but the bare path is not a complete pasteable fragment, so each node now also offers **Template Snippets**: paste-ready output/if-present/loop/joined fragments wrapped in one engine's delimiters. We generate them per engine rather than sharing one form because the languages diverge exactly where the useful fragments live — a link helper interpolates as `{{ zt.fileLink }}` in Liquid (zero-arg auto-invoke) but `<%= zt.fileLink() %>` in Eta, and output/loop/guard delimiters differ (`{{ }}`/`{% %}` vs `<%= %>`/`<% %>`). Liquid Snippets are always offered; Eta Snippets are gated on `TemplateService.javascriptTemplatesEnabled`, read live when the row menu opens, keeping the explorer honest to the same per-device gate that governs rendering.

## Considered options

- **One shared snippet form (extend copy-path to `{{ … }}`).** Rejected: there is no engine-neutral wrapping. A single form would be wrong in whichever engine it didn't target, and would mis-handle helper auto-invoke.
- **Always two submenus (Liquid / Eta), even when Eta is off.** Rejected: a one-child submenu is a pointless extra click for the Liquid-only majority. Instead, Liquid Snippets sit inline in the row menu when Liquid alone is active, and collapse into Liquid / Eta submenus only once JavaScript Templates is enabled and both engines apply.
- **Insert into the active editor instead of copying.** Rejected: the explorer's whole surface (copy-path, copy-value) is clipboard-only and side-effect-free (ADR 0005); Snippets match that.

## Consequences

- The explorer view must receive `TemplateService` (or its `javascriptTemplatesEnabled` getter) — previously it was intentionally engine-agnostic and took no template dependency.
- Snippet generation is pure `(node, engine, kind) → string` logic, kept in its own module and unit-tested independently of the menu orchestration, mirroring the `display-tree.ts` split.
