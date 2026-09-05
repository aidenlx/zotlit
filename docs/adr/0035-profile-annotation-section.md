# A final Annotation Section supplies each Profile's annotation source

The accepted [#940 contract](https://github.com/aidenlx/zotlit/issues/940)
keeps one Profile document in a fixed order: YAML manifest, note source,
and Annotation Section. The exact unindented standalone line
`--- zotlit:annotation ---` starts the required section, which continues
to EOF and can be empty. Both sources use the Profile's language. This
makes the annotation definition distinct from the Managed Block, whose
position controls output in the note.

The parser splits the sources before Liquid or Eta runs. The header has
the same meaning inside Markdown fences and engine raw, comment, or code
regions. Missing, duplicate, and unknown section headers are errors,
including an explicit note header. Splitting consumes only the header
and its following line break, when present. It preserves surrounding
source bytes and LF or CRLF line endings, with ranges into the original
document for diagnostics and edits. Rendered-output conventions remain
separate. The note source retains zero or one Managed Block, its isolated
context, and its existing line-ownership rules.

Every Profile render binds `annotation` to its own Annotation Section.
The shortcuts, native Liquid render and Eta include calls, and calls
from shared partials use that source with isolated Annotation Root data.
Note creation, managed updates, direct insertion, and Imported Notes
therefore use the applicable Profile's source. The binding lasts for that
render alone; other Profiles and generic named-template rendering keep
their own lookup. A manifest partial named `annotation` is a validation
conflict with a rename hint. Other partial resolution stays unchanged.

Export preserves both sources and gathers their reachable shared partials,
including dependencies from the filename template. The local section
satisfies annotation calls. Generated, ejected, and converted documents
use this layout. The released-v2.1 converter retains its independent legacy
lookup and byte-verification baseline. Profile formats remain unreleased,
so this replaces the development format directly. Profile selection,
stamps, inheritance, preview safety, and JavaScript consent are unchanged.

The inline editing agreement from
[#933](https://github.com/aidenlx/zotlit/issues/933) remains: the first
annotation render call offers the editor and later calls link to it.
Edits change the final section in the same document, using targeted source
edits, one undo history, and the invalid-draft rules of
[ADR 0032](0032-web-workbench-edits-one-source-document.md).
The Workbench work under [#863](https://github.com/aidenlx/zotlit/issues/863)
owns that UI implementation and its interaction tests.
[ADR 0037](0037-annotation-box-opens-on-the-annotation-it-produces.md) amends
that editor's Basic-mode face: it opens on the rendered annotation, the
result column keeps the whole note, and a note without a call gets one in
place.

This amends the annotation layout in ADRs 0027 and 0028 and the annotation
lookup in ADR 0034. Managed Block behavior remains as recorded. The fixed
layout avoids a general multipart format and engine-aware boundary rules,
at the cost of reserving one exact document header everywhere in the source.
