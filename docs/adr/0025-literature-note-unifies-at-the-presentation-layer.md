# Literature Note unifies at the presentation layer

A Literature Note's body comes from two templates: `note` (whole body, on create and overwrite) and `content` (the Managed Region, on every update). The v2 simplification goal — make the Literature Note Template the single primary authoring object — had three scored candidates (aidenlx/zotlit#838): **A**, one template file with a `{% managed %}` block; **B**, whole-note regeneration with `{% persist %}` blocks; **C**, presentation-only unification over unchanged internals. We chose **C, extended with editor-level unification** (aidenlx/zotlit#839): the storage model, template grammar, render pipeline, and `%%zt-managed%%` markers stay exactly as they are, and the one-object model is delivered by surfaces — a "Literature note" settings page, and a Template Workbench editor that shows the `note` template as a read-only frame with the `content` template as the editable island, each saving to its own file.

## Considered options

- **A** tied with C under the project's own weighting but pays for the single file with changes to both engines' defaults, two new tag registrations, a compatibility shim with no end date, and two new update-failure surfaces — costs that stop buying anything once an editor presents the pair as one document.
- **B** inverts content ownership (text outside its blocks belongs to ZotLit), requires migrating every note in every vault, and lost under every weighting.

## Consequences

- `packages/templates/` and the note-feature pipeline are off-limits to this simplification effort; the work lands in settings, strings, docs (aidenlx/zotlit#862), and the web workbench (aidenlx/zotlit#863).
- Overturn condition: revisit candidate A only if editor-level unification fails to deliver the one-object mental model.
