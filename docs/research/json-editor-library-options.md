# JSON editor library options

Primary-source review, 2026-09-05. This evaluates library boundaries for JSON-e
authoring. No dependencies were installed and no bundle sizes were measured.
Upstream `main` sources were inspected; they are evidence of API shape, not
a recommendation to install prerelease versions.

## Recommendation

The user's updated constraint excludes a full language service and permits
`codemirror-json-schema`. Use `@codemirror/lang-json` for JSON language support,
then evaluate the schema package's public component APIs through one small
CodeMirror adapter. Keep JSON-e expression detection and semantics in the
existing shared core. The Microsoft service below is comparison evidence,
not the proposed implementation.

Use the schema package only for general JSON structure. Route JSON-e
expression spans to the shared resolver first. A few fixed operator snippets
remain ordinary shared candidates. Avoid the package's bundled `jsonSchema()`
extension because it installs its own CodeMirror hover and completion wiring.
The public APIs permit a narrower composition, but are still CodeMirror-bound.
[Public exports](https://github.com/jsonnext/codemirror-json-schema/blob/main/src/index.ts),
[Bundled extension](https://github.com/jsonnext/codemirror-json-schema/blob/main/src/json/bundled.ts)

## Minimal permitted integration

1. Install `json()` and `stateExtensions(operatorSchema)` on the JSON editor.
   Use `updateSchema` only when that schema changes. The latter dispatches an
   editor state effect, so schema ownership remains in the adapter.
2. Call `jsonCompletion()` with a CodeMirror `CompletionContext` at ordinary
   JSON positions. Display its returned options through the existing shadcn
   popup. Preserve the result's replacement range and execute its `apply`
   behavior through the editor adapter; property options use
   `snippetCompletion`, so they may carry callbacks instead of plain text.
3. For schema hover, call the public
   `JSONHover.getDataForCursor(view, pos, side)`. Read the returned schema
   description/type and pointer into host content; retain the existing 500 ms
   shadcn hover lifecycle. This method requires `EditorView` and schema state.
   It is a reusable CodeMirror lookup, not an editor-independent resolver.
4. Keep JSON-e expression candidates, scope, and exact edits independent of
   the schema package. A later Obsidian host can reuse that core directly.
   Reusing schema candidates there requires a CodeMirror-aware adapter;
   the package does not promise a plain source-text semantic interface.

These steps are a proposal based on source inspection, not a tested integration.
[Schema state](https://github.com/jsonnext/codemirror-json-schema/blob/main/src/features/state.ts),
[Completion source](https://github.com/jsonnext/codemirror-json-schema/blob/main/src/features/completion.ts),
[Hover source](https://github.com/jsonnext/codemirror-json-schema/blob/main/src/features/hover.ts)

## Lightweight constraint: source evidence

The inspected manifest declares `json-schema-library`, `best-effort-json-parser`,
`markdown-it`, Shiki and its Markdown adapter, `yaml`, a JSON-pointer library,
and logging. CodeMirror JSON/JSON5/YAML packages are optional dependencies.
It exposes the root, JSON5, and YAML entry points, with ESM and CommonJS outputs;
it has no `sideEffects` declaration. These declarations describe dependencies,
not delivered browser bytes.
[Manifest](https://github.com/jsonnext/codemirror-json-schema/blob/main/package.json)

There is a concrete eager initialization cost: both completion and hover
import `utils/markdown.ts`. That module constructs a Markdown renderer and
immediately starts an async highlighter initialization with dynamic imports
for two themes and the JavaScript grammar. Selecting `getDataForCursor`, or
avoiding a completion's `info` callback, does not itself prevent that module
initialization. Named imports alone therefore do not establish a lightweight
bundle. Confirm the installed release's output and the actual build chunks
before accepting this composition; no bundle number is established here.
[Markdown module](https://github.com/jsonnext/codemirror-json-schema/blob/main/src/utils/markdown.ts),
[Completion imports](https://github.com/jsonnext/codemirror-json-schema/blob/main/src/features/completion.ts),
[Hover imports](https://github.com/jsonnext/codemirror-json-schema/blob/main/src/features/hover.ts)

## Standard JSON support

| Library | Supplied behavior | Boundary |
| --- | --- | --- |
| `@codemirror/lang-json` | JSON language support and a `JSON.parse` linter | Editor language support; no schema or JSON-e semantic API |
| `jsonc-parser` | Tolerant scanner, AST, paths, visitors, formatting and edits | Editor-independent structure; no schema completion or hover |
| `vscode-json-languageservice` | Schema completion, hover, validation, formatting and document AST | Editor-independent document/position inputs and LSP-shaped results |

CodeMirror's JSON module supplies `json()`, `jsonLanguage`, and
`jsonParseLinter()`. The linter reports one diagnostic from `JSON.parse`.
Its GitHub archive points to a repository move, which is not evidence of
abandonment.
[CodeMirror JSON README](https://github.com/codemirror/lang-json)

`jsonc-parser` tolerates incomplete input, so callers must check returned
errors before treating a parse as valid. Strict JSON parsing uses
`disallowComments: true` and `allowTrailingComma: false`; tolerant recovery
can still support editing. It also exposes offsets and lengths through its
tree and visitor APIs.
[Parser API](https://github.com/microsoft/node-jsonc-parser/blob/main/README.md)

The JSON language service accepts `TextDocument` and a parsed JSON document,
then returns completion lists, hover data, or diagnostics. It requires no
VS Code editor or language-server process. Its public settings permit inline
schemas, comment errors, and trailing-comma errors, so strict JSON does not
require writing another validator. These settings govern diagnostics;
incomplete drafts can still have a recoverable AST.
[API](https://github.com/microsoft/vscode-json-languageservice/blob/main/src/jsonLanguageService.ts),
[Settings and AST types](https://github.com/microsoft/vscode-json-languageservice/blob/main/src/jsonLanguageTypes.ts)

## JSON-e extension boundary

`JSONWorkerContribution` supplies property/value proposals and hover content
by JSON path. Its value hook receives no cursor position inside the string.
The completion collector assigns its own replacement range to every proposal;
for a scalar, that range covers the complete scalar. This is suitable for
JSON values and property snippets, but it does not supply precise replacement
within a JSON-e expression string.
[Contribution interface](https://github.com/microsoft/vscode-json-languageservice/blob/main/src/jsonContributions.ts),
[Completion range and collector](https://github.com/microsoft/vscode-json-languageservice/blob/main/src/services/jsonCompletion.ts#L47-L119)

Hover contributions likewise return content for a JSON path. The service
assigns the containing node's range. It does not locate a specific `zt`
member inside a string.
[Hover implementation](https://github.com/microsoft/vscode-json-languageservice/blob/main/src/services/jsonHover.ts#L20-L54)

Therefore, the recommended wrapper must own expression-span detection,
JSON string escape mapping, local-variable scope, projected `zt` members,
and exact edits. Schema support can describe JSON-e operator objects; it
does not infer expression identifiers or evaluate JSON-e semantics. These
are conclusions from the exposed interfaces, not missing configuration flags.

## CodeMirror bridges

`codemirror-languageservice` already maps LSP-shaped completions, hovers,
diagnostics, and text edits into CodeMirror. Its documented examples call
local service functions directly, with no server transport. However, its
completion and hover adapters target CodeMirror's own popup APIs. Those are
not the requested shadcn/Base UI presentation or a native Obsidian
`EditorSuggest`/`HoverPopover` adapter. It is useful prior art for text-document
and edit mapping, rather than the default shared semantic dependency.
[Bridge API and example](https://github.com/remcohaszing/codemirror-languageservice)

`codemirror-json-schema` supplies schema completion, hover, validation, and
per-editor schema updates. Its custom API exposes CodeMirror completion and
hover sources. The README lists insertion cursor placement as a limitation,
but the inspected completion implementation now uses `snippetCompletion`;
test the selected release instead of treating that README statement as current.
It uses `json-schema-library`, rather than Microsoft's JSON service.
Its declared dependencies include `markdown-it`, Shiki, and a best-effort
JSON parser. Public data lookup and candidate APIs allow custom host popups;
their CodeMirror dependency remains inside the adapter.
[Schema extension API](https://github.com/jsonnext/codemirror-json-schema),
[Dependency manifest](https://github.com/jsonnext/codemirror-json-schema/blob/main/package.json)

## Cost and version checks

Microsoft's inspected manifest is `6.0.0-next.3` and depends on
`jsonc-parser` `4.0.0-next.1`, LSP document/types packages, `vscode-uri`, and
localization support. Its current source is ESM. Select and verify a stable
release before implementation; the reviewed main branch is not a version pin.
The broader service has more responsibilities than a parser, so its actual
Workbench chunk cost must be measured in the app build. Dependency counts
and package archive sizes are not delivered browser bundle sizes.
[Service manifest](https://github.com/microsoft/vscode-json-languageservice/blob/main/package.json)

Before adoption, test the selected release against incomplete JSON strings,
escaped quotes and Unicode escapes, operator schemas, exact acceptance edits,
and the existing one-document undo model. JSON authoring in the Rule editor
is confirmed. Its saved representation and conversion of existing YAML rules
remain open; library selection does not settle those source-contract changes.
[Source-authoring ADR](../adr/0032-web-workbench-edits-one-source-document.md)
