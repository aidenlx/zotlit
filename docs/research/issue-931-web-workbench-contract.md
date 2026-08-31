# Web Workbench hosting and local access

Decision record for [#931](https://github.com/aidenlx/zotlit/issues/931), under
[#863](https://github.com/aidenlx/zotlit/issues/863). The maintainer confirmed the
complete contract and authorized its publication and cherry-pick to
`feat/simple-template`. This is a design record; application implementation
remains follow-up work under #863.

The architectural decision is recorded in
[ADR 0033](../adr/0033-web-workbench-is-public-and-standalone.md). Its number
follows the Profile ADRs and #930's source-editing ADR 0032 on the local feature
branches.

## Rulings

- Serve the web Workbench publicly at `/workbench` in `apps/docs`. Reuse editor
  and rendering modules across hosts.
- Keep the web Workbench usable as a standalone application.
- Use the localhost server for a minimal set of data available only from the
  local installation. Listing citation styles is one intended use.
- Run template rendering in the browser, including when localhost is available.
  Reuse shared rendering code with browser-owned data and execution controls.
- Use built-in samples by default. An explicit user action can load one selected
  Item and its annotations. The preview and field palette use the same snapshot.
  Library-wide browsing is outside the initial API.
- Support file import and download in standalone use. Support optional, scoped
  access to read and save a chosen Profile document through Obsidian. A
  standalone Save produces a file for import; a connected Save can write to the
  vault through the optional capability.
- Require explicit connection approval in Obsidian. Show the website and vault,
  then grant temporary access to the selected Item and Profile. Restrict the
  local server to loopback and approved website origins. Disconnect or plugin
  shutdown revokes access.
- JavaScript support belongs to Obsidian. The web Workbench supports Liquid
  templates and JSON-e Properties. Detect Eta document language, `js` Properties,
  and required Eta dependencies before compilation. An opened Profile that needs
  them receives an unsupported-Profile explanation and an Obsidian handoff.
  Preserve its original source for download; web editing, rendering, and
  connected Save remain unavailable for that Profile.
- Include template data and vault-relative link targets in Item snapshots.
  Exclude absolute filesystem paths and file contents. Show explicit unavailable
  results where an omission prevents an accurate link. Refresh the snapshot only
  on user request.
- Permit a bounded, read-only bundle of required template sources and selected
  CSL content. Report missing dependencies instead of permitting arbitrary file
  reads.
- Reject a connected Save when the loaded revision no longer matches. Retain the
  draft. Create Default's document on Save only if it is still absent.
- Require a valid Profile document for connected Save. Keep incomplete work in
  the browser and permit downloading it as a draft.
- Offer an Obsidian Profile-row action and a command for the current Literature
  Note. Supply the selected Profile and its Item when available through the
  approved connection. Opening built-in Default loads a draft without writing.
- Preserve the draft and current snapshot after connection loss or incompatible
  versions. Local reads and vault Save become unavailable; editing and download
  continue for supported Profiles. Reconnection checks compatibility and the file
  revision before restoring access.
- Return filename, evaluated Properties, creation body, Managed Region output,
  one annotation, and structured diagnostics from browser rendering. Evaluate an
  individual Property against the same snapshot. #936 owns visual presentation
  and rendering cadence.
- Define Save validity as supported syntax, manifest, Profile identity,
  dependencies, and versions. Preview-only evaluation errors remain separate;
  static validation cannot guarantee success against every Item.

## Source, connection, and rendering contracts

### Connection and authorization

The website works with built-in samples before any local connection. A local
connection adds only the operations below. Approval in Obsidian names the website,
vault, selected Item, selected Profile, and granted operations. A temporary
session credential authorizes those operations; the Zotero source ID remains an
identity check. Bind the session to the approved origin and local installation.

Expose the browser bridge only on loopback, including when the Companion server
has been configured with a wider listening address. Validate the request origin
and local host. A successful browser CORS check is not session authorization.
Credential delivery and storage must keep session credentials out of public
requests, logs, exported files, and template inputs. Revocation on disconnect or
plugin shutdown invalidates subsequent local operations.

The connection reports a redacted installation identity, plugin version, browser
bridge version, Template data contract version, and capabilities. Its bridge
contract is separate from the agent CLI and Companion protocol. Unsupported
combinations leave local operations unavailable while standalone use continues.
The UI distinguishes sample data, a connected Item snapshot, and a retained
snapshot after disconnection.

### Profile document access

A document read returns the exact source, selected Profile identity, an opaque
document reference, and its revision. Built-in Default returns the built-in
source with an expected-absence state. Scope authorization to that selected
document; the page supplies no arbitrary filesystem path.

A save supplies the document reference, expected revision or absence state, and
the complete edited source. Obsidian checks authorization, supported language,
static validity, Profile identity, dependencies, compatibility, and current
revision before writing through vault-aware operations. It preserves the source
bytes supplied by the shared editor. Its response identifies the saved revision
or the refusal; a refusal preserves the browser draft and undo history.

External edits, deletion, rename, or another creation of Default invalidate the
loaded state and cause a conflict. Validation and revision checks belong at the
local write boundary as well as in the UI. Default's first Save creates its
Profile document with no manifest bindings; its existence is the customized
state. Discovery observes the vault write in place. Save preserves existing
Literature Notes.

Standalone file import/download requires no local session. A draft download
preserves incomplete source; it is distinct from a validated vault Save.

### Item snapshots and dependencies

One fixed Item snapshot supplies the preview and field palette. It records its
Template data contract version, selected Item identity, and provenance. Only an
explicit load or refresh reads local Item data. The current field filter or
template text does not trigger a library-wide query.

Use the existing public Item, Annotation, and Filename data contracts with the
approved redaction policy. Include annotation data, required Item metadata, and
permitted vault-relative link targets. Exclude absolute filesystem paths,
attachment contents, and complete child-note bodies. Approved Profile, template,
and CSL source reads are separate capabilities from Item data export. Redaction
must preserve a distinguishable unavailable state rather than invent a value.

Transfer data and declarative link descriptors. Trusted shared browser code
restores dates, graph references, string coercion, and parameterized link helpers.
Snapshot extraction uses inert resolver behavior: existing targets can be
represented, while an unavailable imported resource remains unavailable. Loading
or rendering a snapshot performs no attachment or note import.

The bounded dependency bundle contains required template sources, including the
annotation citation's `cite` dependency where used, and selected CSL content when
needed. It preserves partial names, languages, and isolation rules. A missing or
unsupported dependency produces a diagnostic. Template evaluation has access
only to supplied inputs and this bundle; the local bridge is not a general file
reader or template execution service.

### Browser render results

Render the current source and selected snapshot in memory. Results identify the
source/snapshot revision they describe so stale output cannot replace current
output. Provide these independently named results:

| Result | Meaning |
| --- | --- |
| Filename | The filename template result; final vault collision resolution remains a note-creation responsibility |
| Properties | Evaluated values with missing values distinguished from explicit null, plus evaluation diagnostics |
| Creation body | The body generated for a new Literature Note |
| Managed Region | The update output, or absence when there is no Managed Block |
| Annotation | One chosen annotation rendered with the Annotation Root |
| Diagnostics | Validation, unsupported-language, missing-dependency, and evaluation failures, with location when available |

Individual Property evaluation uses the draft entry and the same snapshot, with
Liquid `expr` or JSON-e `value` semantics. It changes no global frontmatter
settings. #930's Rule rows edit YAML source, with JSON also accepted; JSON-e is
the evaluator, not an instruction to replace those rows with JSON-only editors.

Maintain the first-error recovery model and existing location limits from #930.
Transport failures are distinct from document validation and preview failures.
The renderer returns data and generated text; the preview must treat template
output as untrusted content. Finite execution/resource limits and stale-result
handling require implementation verification even with JavaScript unsupported.

## Operation table

Classification is against the agent Workbench CLI at fixed feature commit
`0a7f8b8d8c149d7c49f00453cc42ade92620d9b4`. Every browser bridge endpoint is
new; "Extended" identifies an existing operation's semantics or data machinery
to reuse, not an existing HTTP endpoint. Reuse functions beneath the CLI rather
than exposing a general command runner.

| Operation | Classification | Existing basis | Required contract |
| --- | --- | --- | --- |
| Read Template schema | Existing | `template-schema` and generated contract metadata | Matching Note, Annotation, and Filename schema for the browser |
| Connect / disconnect | New | No browser session today | Redacted identity, versions, capabilities, scoped temporary credential, revocation |
| Load / refresh selected Item | Extended | `template-data` | Renderable, redacted snapshot with inert links; no helper or citation rendering in Obsidian |
| Read selected Profile | New | TemplateService/ProfileService reads | Exact source, Profile identity, scoped reference, revision or built-in absence |
| Save selected Profile | New | Vault-aware file operations and Profile validators | Exact source, expected revision, static validation, compatible version, scoped write |
| Read template dependencies | New | Existing Profile pack/dependency resolvers | Bounded source bundle, including required `cite` inputs |
| List installed citation styles | New | `listInstalledStyles` | `{id, title}[]` |
| Read selected citation style | New | `resolveInstalledStyle` | Resolved standalone CSL XML, with effective locale information as needed |
| Render draft document | Extended | `template-document-render` and shared facade | Browser-only evaluation; complete result set above |
| Evaluate one draft Property | Extended | `frontmatter-eval` and shared field evaluator | Browser-only Liquid/JSON-e evaluation of draft entries; distinct missing/null results |
| Import / download file | New | Standalone browser file interaction | Source round trip and draft preservation without Obsidian |

## Scope and implementation follow-through

The product decisions in #931 are confirmed. The implementation must specify
endpoint paths, session bootstrap details, wire
schemas, bounded dependency traversal, and concrete render limits, then verify
them against this contract. These are implementation work, not working features
proved by the prototypes.

- #930 owns one source buffer, shared history, targeted source edits, and editor
  navigation. Its new ruling is documentation only; shell construction remains
  under #863.
- #934 owns Property editing within the web language subset. #935 owns Details.
- #936 owns preview layout, cadence, Markdown/citation fidelity, and the built-in
  sample catalogue, including `sampleItemType` selection and clearly identified
  sample fallback. Standalone use relies on built-in samples rather than
  requiring a Fixture export.
- #937 owns the palette, focused-editor insertion, and schema presentation over
  the same snapshot. #912 owns entry wording, onboarding, and restore guidance.
- #863 retains product naming and additional Profile lifecycle flows. Reuse
  #918's settled Profile operations where needed; this contract adds no broad
  Profile-management API.

## Explicit changes to earlier rulings

The web-only language restriction narrows #932's Eta trial and the JavaScript
Property/Advanced options in #938. Those trials remain useful evidence for
Obsidian; web JavaScript authoring and execution are out of scope.

Relative to #930's generic shared editing model, an opened JavaScript-dependent
Profile is unsupported for web editing and connected Save even if the shared
document parser accepts its source. Supported web Profiles still distinguish
Save validation from preview-only failures. #931 adds the supported-language,
dependency, compatibility, and revision checks at the browser/local boundary.

Static validation checks supported syntax and document/Profile invariants; it
does not require successful evaluation against the current Item. Invalid source
remains in the editing history and can be downloaded as a draft. A supported
Profile's preview-only runtime error does not by itself block Save.

## Prototype evidence

- [#938](https://github.com/aidenlx/zotlit/issues/938#issuecomment-5468828547)
  settles the three-column frame, one selected Item, and persistence only on
  Save. Save changes the Profile document and leaves existing notes unchanged.
- [#932](https://github.com/aidenlx/zotlit/issues/932#issuecomment-5469547827)
  demonstrates browser Liquid and Eta rendering with sample data. Its local
  JavaScript switch does not authorize execution in Obsidian.
- [#933](https://github.com/aidenlx/zotlit/issues/933#issuecomment-5470022107)
  demonstrates document parsing and body/annotation rendering through the
  shared facade. Save updates tab state; the trial supplies no document
  transport or full filename/frontmatter preview.

The prototype source and recorded checks were reviewed. Browser tests were not
rerun for this interview.

## Local citation-style data

The existing `listInstalledStyles` function returns `{id, title}[]`. A browser
catalogue can use that shape without exposing filesystem paths. There is no
HTTP endpoint for it yet.

Previewing citations with an installed style, including local edits, also needs
the selected style's resolved CSL XML. The existing `resolveInstalledStyle`
function supplies that content. The native `zotlit:csl` CLI returns a temporary
file path, so a browser endpoint needs a different response.

These functions were checked in
`apps/obsidian/src/services/pandoc/styles.ts` on `feat/simple-template` at
`0a7f8b8d8`. The catalogue and bounded selected-style content reads are approved;
the precise wire format remains to be specified.

## Browser rendering constraints

The existing inspection serializer evaluates helpers and enumerable getters.
An annotation's `citation` getter renders the active `cite` template in
Obsidian. Browser rendering therefore needs a data export that carries the
required inputs and template sources for browser evaluation.

A Profile document can resolve installed partials when its manifest supplies no
local partial registry. Transporting the Profile source alone does not make
every existing Profile self-contained. The approved dependency bundle supplies
required sources and reports missing dependencies.

The Eta trial executes user source synchronously with the page's privileges.
That execution path is outside the approved web product. The Obsidian
JavaScript Templates gate continues to govern execution in Obsidian.

## Validation and compatibility evidence

At fixed feature commit `0a7f8b8d8c149d7c49f00453cc42ade92620d9b4`,
`parseLiteratureNoteTemplate` validates document structure and manifest shape
without rendering. Liquid syntax, Profile filename and identity, dependency
availability, compatibility, and save revision need additional checks.
Static validation cannot prove successful evaluation for every Item; JSON-e
expressions can fail when evaluated against particular data.

The existing CLI envelope version, Template data contract version, and Companion
protocol version describe different interfaces. A browser connection needs its
own compatibility negotiation and a redacted installation identity.
