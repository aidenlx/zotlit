# Template highlighting and completion

Design interview for the language features in
[#947](https://github.com/aidenlx/zotlit/issues/947), from the prototypes under
[#863](https://github.com/aidenlx/zotlit/issues/863). Decisions below were
confirmed on 2026-09-05. All interview questions are resolved. Implementation was authorized through
the implement skill on the same date.

## Confirmed scope

- Re-evaluate the existing prototype-derived language support and rebuild the
  parts needed for a reliable shared implementation.
- Keep Liquid and Eta language support in the shared Workbench core. Eta
  support prepares the later Obsidian implementation. The web host retains
  Liquid and JSON-e authoring under
  [ADR 0033](../adr/0033-web-workbench-is-public-and-standalone.md).
- Provide Template Completion for contract paths, statically traceable Liquid
  loop and assignment variables, filters, tags, partial names, and snippets.
  Initial Eta completion covers `zt` paths and known helpers.
- Cover the note body, Annotation Section, filename, Liquid Property values,
  and their regions in Advanced, with the data root appropriate to each region.
  JSON-e rules retain YAML highlighting; expression completion is a separate
  scope.
- Keep typing focus in the web editor. One popup reads its query from the text
  being edited. The sidebar and the explicit Add a field sheet retain their
  own search inputs. Use shadcn/Base UI for the web popup presentation.
- Share context detection, candidates, matching, complete replacement edits,
  and resulting cursor placement. Each host owns popup rendering, focus,
  keyboard handling, positioning, and applying edits through its editor API.
  This follows the host boundary in
  [ADR 0032](../adr/0032-web-workbench-edits-one-source-document.md).

## Existing implementation and evidence

The port already exists in `packages/workbench/src/language/`. The web
`SliceEditor` installs language parsing and native CodeMirror completion, with
a separate field popup triggered by `{{`. The current completion adapter omits
the option-specific replacement ranges and cursor offsets produced by the
shared suggestions module. The web editor also lacks the highlighting style
extension used by the prototype.

The [Obsidian editor suggester research](./obsidian-editor-suggester.md) records
the runtime evidence for the editor-focus interaction and the separation
between popup anchors and accepted edits. It also records the difference
between native `EditorSuggest` and CodeMirror autocomplete.

## Completion behavior

- Offer every field valid for the current data root, including fields absent
  from the selected Item Snapshot. Show sample values where available. Lead
  with common fields before a query; rank exact and prefix matches before
  fuzzy matches when typing. Match field names, human labels, and paths.
- Enter accepts, arrow keys navigate, Escape dismisses, and Ctrl-Space opens
  completion explicitly. Tab retains its normal editor behavior. Enter
  confirms IME composition while composition is active.
- Scalar-field acceptance completes the expression and supplies a missing
  closing delimiter. Object-field acceptance inserts the path and a dot, then
  continues completion. Whole-block transformations, such as an array-to-loop
  snippet, are explicit separate suggestions. Each acceptance is one undoable
  edit.
- Offer a local variable's name when its type is uncertain. Offer members when
  static analysis establishes its type. Follow contract-derived assignments
  and loops within their applicable scope.

## Isolated local scopes

The Managed Block and surrounding note source have independent local-variable
scopes. Note-local variables remain available to the surrounding note source;
managed-local variables remain available inside the Managed Block. The Managed
Block receives its own `zt` binding to Note Root data. Sharing the same data
root does not share local variables.

The Annotation Section has its own isolated local scope and Annotation Root.
These boundaries follow the existing Managed Block and Annotation Section
definitions in the [plugin glossary](../../apps/obsidian/CONTEXT.md).

Completion must distinguish this example's local scopes:

```liquid
{% assign outside = zt.title %}
{{ outside }}
{% managed %}
{% assign inside = zt.title %}
{{ inside }}
{% endmanaged %}
{{ outside }}
```

Within the Managed Block, `inside` is a candidate after its assignment. Outside
the block, `outside` is a candidate after its assignment. Each scope resolves
`zt.title` from Note Root data independently.

## Implementation and verification

Review the current Liquid and Eta grammars, range detection, and highlighting
integration against the supported language contexts. Keep semantic completion
and edit results usable by both the web adapter and a later native Obsidian
`EditorSuggest` adapter. Preserve surrounding source and line endings when
applying completion edits through the shared document history.

Verify candidates and exact edits with realistic source examples, including
scope isolation in both directions, unknown local types, root changes, partial
expressions, nested paths, and explicit block snippets. Verify the web
interaction in the browser: visible highlighting, retained editor focus,
keyboard and pointer acceptance, composition handling, dismissal, continued
completion, and undo. Include LF and CRLF source preservation.

The exact web component composition and highlighting integration are subject
to implementation review against the confirmed interaction. The linked
[shadcn Command component](https://ui.shadcn.com/docs/components/base/command)
uses `cmdk`; its separate search input is not the query owner for typing
completion.

## Implemented boundaries

`@zotlit/workbench/completion` exports editor-independent suggestions, scope
resolution, and complete edits. Shared parser modules support Liquid and Eta.
The CodeMirror adapter applies edits with history isolation. The web adapter
uses a cmdk Command list in a Base UI Popover and retains editor focus.
`WorkbenchDocumentController.templateRegions` supplies Profile region roots
and expression boundaries to completion and embedded highlighting.

Regression tests cover Managed Block isolation, captures, conditional locals,
existing member separators, scalar delimiters, CRLF snippets, bare expressions,
and master-document undo isolation. Chrome checks cover visible highlighting,
arrow navigation, Escape, Ctrl-Space, object continuation, pointer acceptance,
retained focus, undo, normal Tab handling, and Enter during composition.
