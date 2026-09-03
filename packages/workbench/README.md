# @zotlit/workbench

The Workbench core shared by the web Template Workbench and the Obsidian plugin.
Subpath exports: `bridge`, `document`, `explorer`, `language`, `render`, and the
Node-only `snapshot`. The package has no React dependency and targets
CodeMirror at the versions Obsidian pins.

## Document

`@zotlit/workbench/document` owns one Profile document and its editing rules.
The complete source is the authority ([ADR 0032](../../docs/adr/0032-web-workbench-edits-one-source-document.md)):

- `WorkbenchDocumentController` — a headless master `EditorState` holding the
  only undo history. It re-derives the slice ranges and the Problems list from
  the source after every change, keeps a draft that does not parse editable, and
  quarantines the focused slice from an edit computed elsewhere. It reads and
  writes the line break the document arrived with.
- `workbenchSlice(controller, id)` — the editor extension for one pane, in the
  shape Obsidian uses for Live Preview table cells: its own state over its own
  small document, no history of its own, an echo-guard annotation across the
  boundary, the child's user event forwarded so keystrokes group into one undo
  step, undo and redo routed to the master, and a wholesale child refresh.
- `manifestValueEdit(source, path, value)` — the one targeted YAML patch, so a
  form control changes a single manifest node and every other byte survives.
- `manifestNodeRange(source, path)` — the source range one manifest node covers,
  so a host can tell which manifest value an editor position sits in.

## Render

`@zotlit/workbench/render` renders a Profile against an Item Snapshot and
schedules those renders:

- `renderProfile(source, snapshot)` — the six-part result set with diagnostics,
  stamped with the source and snapshot revisions.
- `createRenderScheduler(options)` — one debounce (300 ms), one Worker per
  render terminated on its deadline, and a revision check that drops a result
  the reader has already typed past. The host supplies the Worker factory.

## Language

`@zotlit/workbench/language` holds the editor support for Liquid and Eta
Templates, ported from the reviewed language prototype:

- `liquidMarkdown` — the upstream Liquid language over a Markdown base, plus a
  delimiter accent decoration (`zt-liquid-delimiter`).
- `liquidRanges(source)` — a quote-aware delimiter scanner that bounds
  suggestions and hover and marks the Managed Block tags as `structural`.
- `eta`, `etaLanguage`, `etaRange(source, position)` — a Lezer grammar for
  Eta v4 default tags with JavaScript mounted inside each tag body, plus the
  auto-pair extension `etaAutoPair()`.
- `suggestions(source, position, config)` and `hoverHint(...)` — contract-driven
  field, filter, tag, partial, and snippet options; `rootAt(...)` resolves the
  root in scope at a position.

Regenerate the Eta parser after editing `src/language/eta.grammar`:

```sh
pnpm --filter @zotlit/workbench generate:eta
```

Hosts supply the syntax colors: the Liquid delimiter class above and the Eta
delimiter class `zt-eta-delimiter`.

### Limits

Recorded from the prototype review; these affect editing, not rendering.

- The upstream Liquid grammar has no output whitespace-control (`{{-`, `-}}`)
  syntax, no filter-token colors, and no custom end-tag names, so
  `{% endmanaged %}` and `{% endbq %}` parse as error nodes.
  The delimiter accent also colors literal delimiters inside strings and raw
  blocks.
- Inside a multiline `{% liquid %}` block, filter completion works; tag-name and
  partial-name completion there are not covered.
- The Eta grammar covers Eta v4 default tags, not EJS. The close delimiter ends
  the tag body even inside a JavaScript string, template literal, or comment,
  where the engine keeps scanning. Whitespace between a trim marker and the
  output prefix (`<% = x %>`) is not recognized as a prefixed tag.
- A JavaScript block split across Eta tags produces editor recovery nodes while
  the engine renders the complete program.
- Loop-variable inference, JavaScript local-variable scope, bracket-path
  completion (`zt["title"]`), and screen reader and IME audits are outside the
  port.
- [ADR 0035](../../docs/adr/0035-profile-annotation-section.md) replaced the
  earlier rule that gave both `annotation` and `managed` a paired-tag
  completion. The Annotation Section now starts at the `ANNOTATION_HEADER`
  line, so only `managed` completes as a paired block.
