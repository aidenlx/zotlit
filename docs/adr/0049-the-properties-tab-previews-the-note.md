# The Properties tab previews the note

While the editor was on the Properties tab, the result pane switched to a
third result mode, Final properties, on both hosts. The pane heading said
"Final properties"; the shared `PropertiesResult` said it again in an h3
above the same fold list the note sheet already shows at its top, then
repeated under a "What each rule produced" disclosure the summary every
Properties row already carries. In Obsidian the fold rendered as a bare
grid there and through the app's own `metadata-container` in the note
result, so one list had two looks, and the Markdown toggle had two YAML
writers: the render's `frontmatterBlock`, and a second `stringifyYaml` in
the note sheet.

Decided in the Note preview grilling on this branch (2026-09-10): the
Properties tab shows the ordinary note preview. The sheet's own Properties
block at the top of the note is the final list, and the result modes are
note and annotation. The pane heading stays "Note preview" with its
"New note / Updated note" caption. In Obsidian the Properties block opens
when the editor's tab becomes Properties and follows the reader's toggle
after that; the open state stays local to the sheet. The Markdown view on
both hosts prints the render's own `frontmatterBlock` in `---` fences
above the body, so one writer produces the YAML the reader sees.

## Considered options

- **Keep the mode, drop the h3 and the disclosure**: removes the echo and
  keeps a mode whose only content the note sheet already shows.
- **A properties-only sheet**: the native block without the body; one
  renderer, but a mode and a heading remain for a list that sits at the top
  of the note anyway.
- **Obsidian only**: leaves `PropertiesResult` alive for the web alone,
  against the one-behaviour rule.
- **Persist the block's open state with the view**: a store field and a
  migration for a state no chrome names.

## Consequences

- `PropertiesResult`, the `properties` result mode and `propertiesResult`
  prop on `ResultBody`, the `fold` list variant, and the messages
  `workbench_result_fold` and `workbench_result_by_entry` are gone.
- `WorkbenchMarkdownProps` carries `frontmatterBlock`; both sheets print it
  in the Markdown view.
- The Obsidian sheet takes `expandProperties`, derived from the editor's
  authoring context.
- WORKBENCH-DESIGN.md records the rule under Obsidian panes; ADR 0048's
  "Final properties" heading is superseded here.
