# @zotlit/workbench

The Workbench core shared by the web Template Workbench and the Obsidian plugin.
Subpath exports: `bridge`, `document`, `explorer`, `language`, `render`, the
headless `ui`, and the Node-only `snapshot`. React is a peer dependency of `ui`
alone; every other subpath is free of it. The package targets CodeMirror at the
versions Obsidian pins.

It carries no logger: it runs in a browser page and inside Obsidian, and it
names every decision a host acts on in the value it returns —
a `WorkbenchProblem`, a `RenderDiagnostic`, a `LocalBridgeConnection` state — so
the host logs. That is a package-scoped exception to
[the logging policy](../../policies/logging.md).

## Development

The `development` export condition maps each browser-safe entry to its source,
so a host's Vite dev server and Vitest read `src/` directly and an edit here
hot-updates the page without a rebuild. A production build, Node, and the type
checker take the built `default` entry, so `pnpm build` still has to run before
a release or a Node consumer sees a change. Imports inside `src/` use the
`#/` subpath import the package's `imports` field maps to `src/`, which every
consumer of the source resolves without an alias of its own.

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
  Pass `true` as the third argument for a JSON-e property: initialize its text
  with `jsonLayout(source, true).text` and use `jsonPosition` to map offsets.
  The editor shows two-space indentation and stores compact JSON in YAML.
  Draft layout and selections, including whitespace-only edits, use master
  history effects. Token spelling and string contents remain unchanged.
- `manifestValueEdit(source, path, value)` — the one targeted YAML patch, so a
  form control changes a single manifest node and every other byte survives.
- `manifestKeyEdit(source, key, value)` and the controller's `setManifestKey` —
  one top-level manifest key written, or removed with its own line when the
  value is `undefined`. They are the two halves of Override and Use default, so
  an explicit empty path, a null style, and a `false` toggle each stay distinct
  from an unset key; a key the manifest never wrote lands at its foot. Each call
  is one undo step.
- `manifestNodeRange(source, path)` — the source range one manifest node covers,
  so a host can tell which manifest value an editor position sits in.
- `manifestScalarSlice(source, path)` — the text a manifest scalar holds, inside
  its quotes when it has them, so the note-name template is edited as template
  source. It answers null for a value one line cannot hold — a block scalar, a
  folded plain scalar, or a quoted one carrying an escape — which leaves that
  value to Advanced. The controller keeps it as the `filename` slice and reports
  it through `filenameSlice`.
- `managedFrontmatterEntries(source)` — every Managed Frontmatter entry the
  manifest authors, with its key, language, merge strategy, the whole lines it
  occupies, and the expression a row edits. It answers `rows` with those
  entries, `source-only` when the manifest parses and its list is written in a
  shape a form cannot patch — a flow list, or an entry that is not a block
  mapping — which leaves that list to Advanced, and `unparsed` while the
  manifest itself does not parse.
- `managedEntryEdit(source, action)` and the controller's `editManagedEntry` —
  the one place a Properties action becomes source bytes: add a property, add a
  Spread Entry, add an override after an entry, remove, reorder, change the
  language, or set the key or merge strategy. Each is one undo step, rewrites
  only the lines of the entry it names, and starts a new expression on a
  language change rather than translating the old one.
- `noteRegions(source, note)` — the boxes the note body carries, in the offsets
  the source is read in: every annotation render call, in the shortcut form and
  in the native `render "annotation"` form, and the Managed Block with its
  line-owning tags apart from the tag text. A call inside a Liquid `raw` or
  `comment` block, or inside a Markdown code fence or code span, is prose about
  a call rather than a call, so it is left out. The controller keeps the answer
  as `noteRegions`, and a host reads the same function over a pane's own text.
  @see docs/adr/0034-template-rendering-shortcut-is-annotation-specific.md
- `partialCalls(source, region, language)` — every Shared Partial call inside
  one region: a Liquid `render` or `include` tag, or an Eta `include("name", …)`
  call, whose first argument is a plain quoted name, with the name, the
  arguments the call passes after it, and the line it owns. It skips the same
  raw, comment, and code regions `noteRegions` does, and skips the five names
  another ZotLit template already answers to — `filename`, `note`, `annotation`,
  `content`, and `citation` — which no partial can be given. Any pane reads its
  own calls through it — the note body, the Annotation Section, and the one
  editor a plain document opens.
- The controller's `annotationSection` — the Annotation Section's header line
  and the source under it, which is also the `annotation` slice. A draft the
  parser refuses keeps the regions it had, so the reader repairs the text in the
  editor they are in; a document that has never carried a section answers null.
- The controller's `repairAnnotationSection()` — the header a document without
  one is missing, written as a line of its own at the end of the file in one
  undo step. It writes that header and the line break that ends it and nothing
  else, so the section it opens is empty until the reader writes in it.
- `entrySlice(position)` and `entryPosition(id)` — the slice id one entry's
  expression is edited through, and the entry a slice id names. The controller
  re-derives those ranges from the manifest after every change, and keeps the
  last list it parsed while a draft is mid-repair; a list that parses into a
  shape no form can patch takes the rows and their ranges with it, and
  `managedEntries` answers null. A problem carries the pane it is
  repaired in: the row of the entry the parser pinned it to, `filename` for the
  manifest value the note name lives in, `note` for a Managed Block or a stray
  section header inside the note body, and Advanced for the document's own
  structure and for every error no pane can name.

### Limits

An entry whose `value` spans several lines is edited as the source holds it:
the slice carries the continuation lines' own indentation, and a line the
reader adds needs its own indent. A single-line rule — the shape every action
writes — has no such catch.

## UI

`@zotlit/workbench/ui` is the headless component tree both hosts mount over one
Profile document (ADR 0044). It renders structure and behaviour and no look:
every component marks its parts with `data-part` and their state with
`data-state`, and `WorkbenchThemeProvider` takes one optional class map, keyed
by component and part (`WorkbenchParts` lists them), plus an icon renderer.
Call sites pass no classes. `WorkbenchHostProvider` takes the host adapter —
`menu`, `dialog`, `confirm`, `suggester`, `tooltip`, `hoverCard`, `notice`,
`render`, `matchData`, `insertTarget`, `persistence`, `messages`, and
`getLocale` — so
Obsidian shows its own `Menu`, `Modal`, `SuggestModal`, and `Notice` and the web
shows Base UI. `WorkbenchEditorProvider` carries one editor instance: the
zustand vanilla store from `createWorkbenchEditor` (tab, selected Item, focused
root, preview mode and live state, Advanced)
beside the `WorkbenchDocumentController`, which stays the document
authority, and the one Render Scheduler its result surfaces share;
`useWorkbenchStore`, `useWorkbenchController`, `useDocumentRevision`,
`useRenderScheduler`, and `useRenderState` read them.

`createWorkbenchEditor({ host, controller })` owns the store and its scheduler;
dispose the editor when it closes. The scheduler uses a 300 ms quiet time after the last edit, `run()` for Run,
`pause()` for Stop, which lets a render already in flight finish, On demand read
from the store, and a per-start stamp that drops a result naming a source,
paper, annotation example, or preview mode the reader has moved past. It reads
the document controller and the store itself; the editor calls `host.render`, which
answers one request with a promise on the calling thread and whose rejection
reads as a `render-error` diagnostic. An optional `mapResult` gives successful
and failed results the host's own result shape. The host calls `setInput` with the
paper, the annotation example, its own bundle, and `hold` where nothing may
render yet — `hold: "invalid"` for the one hold that is a failure, a document
the parser refuses, which reads as `staleReason: "invalid"`. Its state —
`result`, `retained`, `busy`, `stale` — is what every result surface paints.
`retained` is the last result that produced output, kept while the document is
invalid or `result` is a failed attempt, and the reader is still on the paper,
example, caller, and mode it was rendered for, so a repair reads against
working output rather than an empty pane; a source edit leaves that match
intact. Its `trigger` says whether Run or the quiet time after an edit asked
for the shown result, and `attempt` counts the results it has published, so two
attempts over the same bytes stay distinct. Outside the editor provider the
tree paints inert, which the web's skeleton relies on. The components so far:
`TabBar` and `TabPanel`, `EditToolbar` (Basic against Advanced, undo, redo, a
host's own controls as children), and `ProblemsFooter` with `problemText`,
`problemAction`, and `diagnosticText`, the words for every core code. A host
that passes `onAction` gets the button `problemAction` names for the codes a
host can repair on the reader's word; a Profile edited beside a vault reports
`bundled-partial` for the partials its manifest still carries, and the vault
host unpacks them into files with `dropBundledPartials`.

`ProblemsFooter` is the editor's Problems area, and the editor owns detailed
diagnosis (ADR 0056). `workbenchDiagnoses(problems, diagnostics)` folds the
parser's problems and the renderer's diagnostics into one list of
`WorkbenchDiagnosis`, each with an identity built from its code, the object it
names, and where it is repaired — never from its message text.
`useWorkbenchProblems` holds the reader's selection and their open-or-collapsed
choice: automatic checks leave that choice alone, while `select` — what a
source marker and the preview's Show problem call — and a failed explicit Run
open the explanation. `diagnosisExplanation` writes the affected object, a
plain condition, and a text suggestion; repairs stay the reader's own edit.
A preview publishes what its render found to the editor beside it rather than
explaining it beside its own empty result.

Technical details shows the failed attempt's report, and Copy error report
copies that same text through the host's `copy`; Ask the community links to the
host's `communityUrl` beside it, and both stay reachable while the disclosure
is collapsed. A clipboard that refuses opens the disclosure and says the copy
failed, leaving the text to select by hand. `diagnosisReport` reads the report
one diagnosis carries; `useWorkbenchProblems` keeps the last one read, so an
open area whose problems are all resolved still offers Copy last error report.

`usePartialBoxes(controller, slice, host)` draws the Partial Placeholder over
every Shared Partial call in one pane: the editor extension to pass that pane
and the boxes to render beside it. The host answers the names the last render
could not resolve, opening a partial, reading one's problem, and rendering one
for the caller that pane's slice supplies — a missing partial is the engine's
own render failure, never a scan, so the box's short Missing marker appears
only for a name a render reported, and selects that problem in the editor's
Problems area.

The host supplies `messages` and `getLocale` through `WorkbenchHostProvider`.
The web passes its Paraglide facade; Obsidian passes its Language Pack facade.
Components read `useWorkbenchMessages()`, and pure text helpers take the
message functions as an argument. A host without overlays, such as the web
skeleton, can use `WorkbenchMessagesProvider` directly.

`pnpm generate:message-types` reads the root `workbench_*` catalog through the
existing message compiler and emits the `WorkbenchMessages` type contract.
The English pack it emits is used only by shared tests. Turbo runs generation
before `build`, `test`, `typecheck`, and `typecheck:test`; direct package-tool
runs need those generated files first. The tree stays inside the
`preact/compat` surface, and its suite under `src/ui/` runs twice in `pnpm test`:
the `ui-react` and `ui-preact` Vitest projects, the second with React aliased to
`preact/compat` and Testing Library to its Preact build.

## Render

`engineEvidence(error)` takes the engine's own account — message, name, stack,
the chain behind it, a caret excerpt, and the location the engine named — at
the boundary that catches a failure, before a diagnostic reduces it to one
message. The scheduler pairs it with that attempt through `captureRenderReport`
and hands the result's diagnostics a `report`; `formatRenderReport` is the one
serializer, so displayed and copied text are the same string. Its labels and
its `unavailable` marker stay English: a report travels to an issue or the
community, where one format keeps reports comparable. A scheduler's
`reportContext` names the Template Document, language, rendering root, Item,
and versions that only its host knows.

`@zotlit/workbench/render` renders a Profile against an Item Snapshot; the
Render Scheduler that decides when lives in `@zotlit/workbench/ui`:

- `renderProfile(source, snapshot, options)` — the result set with diagnostics,
  stamped with the source, snapshot, and selected annotation revisions. Options
  carry the connected resources and an independent annotation example as its
  serialized root and matching descriptors. Its parent Item supplies its citation;
  the note keeps rendering against its own snapshot. Every Managed Frontmatter
  entry evaluates on its own against that one snapshot, so `properties` carries
  each entry's own result under the 1-based position that produced it, `fold`
  carries the frontmatter the note gets once every entry has merged, and a
  property diagnostic — an evaluation failure, a `js` entry, or an append the
  fold could not take — names the entry responsible for it.
- A dependency bundle a Local Bridge supplied is registered by name before the
  render, and a partial in it written in Eta is named as an
  `unsupported-dependency` diagnostic rather than defined: the web host renders
  Liquid and JSON-e only, wherever the source came from.
- The bundled Resolved CSL Style is checked here: a style the Local Bridge
  could not resolve, and one whose content is no standalone CSL style, are both
  `citation-style-error` diagnostics. CSL formatting itself stays in Obsidian,
  which is where a Literature Note's citations are rendered.
- `SAMPLE_ANNOTATIONS` — six built-in annotation examples covering highlight,
  underline, note, text, image, and ink, with comments, tags, and empty optional
  fields. Each example carries the matching descriptors needed to restore it.

A `RenderDiagnostic` and a `WorkbenchProblem` name what went wrong by `code`,
with the values that fill it in `params`. This package holds no Language Pack
facade — it renders in a browser page and inside Obsidian — so the host writes
each code in the reader's own language. `message` carries the wording this
package did not author: the template engine's failure text, the Local Bridge's
own, and the document parser's.

`renderFailureDiagnostic(error, caller)` reads one thrown render failure
against the source that render read and keeps its three answers apart:
`engine` is where the engine itself said it happened, `caller` the document a
failure named as holding the call, and `callSite` the call in that source which
reached the failing template — the one verified repair location. Each is set
only on its own evidence, so a name the source never spells leaves `callSite`
absent and the host says the location is unverified rather than sending the
reader to a guessed line. `templateCalls` in `@zotlit/workbench/document` is
the scan behind it, and reads the reserved names `partialCalls` drops.

## Bridge

`@zotlit/workbench/bridge` holds the wire schemas and the browser client. The
session credential lives in `sessionStorage` and outlives a transport failure:
a dropped fetch marks the connection lost and keeps the credential, so a reload
re-checks compatibility and revision with it, and `resume()` does the same from
the page, so Reconnect after a blip costs no fresh approval. A refusal (HTTP
401) and a version mismatch clear it, and so does an explicit disconnect.

## Language

`@zotlit/workbench/language` holds the editor support for Liquid, Eta, and JSON-e
authoring:

- `liquidTemplate` — the upstream Liquid language over plain text.
- `templateHighlighting` and `templateToken` — the `zt-template-*` classes every
  editor emits per token kind; a host colors them.
- `jsonRule` and `embeddedJsonE` — JSON parsing and JSON-e expression token colors
  in Property rules and Advanced, using the same source regions as completion.
- `liquidRanges(source)` — a quote-aware delimiter scanner that bounds
  suggestions and hover and marks the Managed Block tags as `structural`.
- `eta`, `etaLanguage`, `etaRange(source, position)` — a Lezer grammar for
  Eta v4 default tags with JavaScript mounted inside each tag body, plus the
  auto-pair extension `etaAutoPair()`.
- `suggestions(source, position, config)` and `hoverHint(...)` — contract-driven
  field, filter, tag, partial, and snippet options; `rootAt(...)` resolves the
  root in scope at a position.
- `templateCompletion(read, presentation?)` — the optional CodeMirror typing popup adapter; a host passes the classes and extra cells its rows wear, and reads each row's `completionSuggestion(completion)` to draw them.
  `read()` answers with the pane's current root, partials, and Item values.
- `@zotlit/workbench/completion` exports the editor-independent `hoverHint(...)`
  resolver: the source range and property facts, including type, description,
  and sample. Hosts own hover timing, geometry, presentation, and dismissal.
  The web host uses a shadcn Base UI Hover Card with a 500 ms opening delay.
  A native Obsidian adapter can render those facts through `HoverPopover`;
  see the [native hover research](../../docs/research/obsidian-editor-hover.md).

Regenerate the Eta parser after editing `src/language/eta.grammar`:

```sh
pnpm --filter @zotlit/workbench generate:eta
```

JSON-e rules use `jsonc-parser` for incomplete JSON and source ranges. The shared
resolver handles operator keys, functions, contract paths, bracket members, and
statically traceable locals. Each rule has its own scope. The JSON-e runtime is
the semantic-validation authority; the editor does not execute drafts to infer
local values. JSON syntax errors appear in the document Problems list.

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
