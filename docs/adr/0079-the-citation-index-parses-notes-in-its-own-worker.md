---
status: proposed
---

# The Citation Index parses notes in its own worker

The Citation Index will also index every Durable Annotation Link in the vault, so "where is this Annotation used" and its backlinks can be answered. Obsidian's metadata cache cannot carry these links. Its worker drops every link whose URL contains `:` and does not start with `./` or `../` (`worker.js:7770` in 1.14.4). That happens in every form (`[p. 42](…)`, `[](…)`, `![](…)`) and in every place, and no API lists external links per file. ZotLit therefore parses notes itself. One parse finds Pandoc citations, Wikilink Citations and Annotation Occurrences. It runs in a dedicated worker over a trimmed `@lezer/markdown` grammar, and the renderer keeps the index.

Amends the parse side of the Citation Index. [ADR 0073](0073-the-citation-index-reads-in-the-zoteroreads-worker.md) still owns citation reads. The worker yields through bounded in-flight requests, not the 20-file chunks that follow [ADR 0050](0050-chunked-work-yields-via-messagechannel.md).

## Why

- **One parse, one exclusion rule set.** Today citekeys come from `maskExclusions` plus `maskWikilinks` plus the Pandoc grammar, and wikilinks come from the metadata cache. The two sources disagree about `%%` comments, because Obsidian records links inside comments. Pandoc export has a third copy of the rules. The masks also approximate CommonMark. They miss code nested in quotes, callouts and lists. They mask `$5 [@k] x$`, ignore `\$`, honour `\` inside wikilinks, and read code spans on one line only.
- **The main thread should not parse Markdown.** Obsidian already parses every note in its own worker. It keeps a main-thread parser only for canvas text under 5,000 characters (`app.js:177815`). ZotLit's backfill and every `changed` event parse on the renderer today.
- **The superlinear citekey scan is a grammar bug, not a reason for the worker.** `scanNormalCitations` (`packages/templates/src/pandoc-citation.ts:426-440`) scans every key in the document for every `[`. That makes it O(brackets × keys), whatever the note's length: 12 ms at 1,000 citations, 120 ms at 4,000, 470 ms at 8,000. The `keys.filter` at `:646` and the key-against-exclusion check at `:413-418` add smaller quadratic terms. The fix is local and still needed, because export and the editor read the same grammar. With it fixed, the linear masks still cost about 17 ms per million characters. The backfill pays that for every note.

## Decision

### What a parse records

- **Annotation Citation.** A Durable Annotation Link whose text is exactly empty (`[](zotero://…?annotation=…)`, also `[](<zotero://…>)`) is a Citation of the Annotation's parent Item, with the page label as its locator.
- **Annotation Occurrence.** Every Durable Annotation Link is an Annotation Occurrence, in one of three forms:
  - citation: `[]`
  - labelled: any other text, including whitespace-only text, and `<zotero://…>`
  - embed: `![…](…)`
- **Not recorded:** bare `zotero://` text, reference-style links, HTML `<a>`, and Attachment File Links with an Annotation Anchor (`file://…#zt-annotation=…`).
- **Malformed citation-form links.** An empty-text `zotero://open/` link that `parseAnnotationOpenUri` rejects is recorded as a malformed Annotation Citation and shown as a Reference Error, mirroring malformed Citation Fragments. An attachment-only link is one case. Other forms that fail to parse are ordinary links to Zotero and are dropped.
- **Classifier.** One worker-safe classifier decides the form. The scanner and the Reading view and Live Preview renderers of [#1678](https://github.com/aidenlx/zotlit/issues/1678) import the same module.
- **Identity.** Occurrences are keyed by the Annotation's Indexed Key, which also covers group Libraries.
- **Wikilink Citations come from this parse too.** They are stored like the other sources, not derived from the metadata cache.

### What a parse excludes

Code (fenced, indented, inline), math (`$…$`, `$$…$$`), `%%` comments and frontmatter are excluded for every source. **The index records what the rendered and exported document references.** Obsidian's backlinks include links inside `%%`. We treat that as Obsidian's flaw and do not copy it. Frontmatter properties are metadata, so their links are not recorded.

### The parser

- **Trimmed `@lezer/markdown`,** already a dependency of `apps/obsidian`.
  - Removed parsers: `Emphasis`, `HardBreak`, `Entity`, `ATXHeading`, `SetextHeading`, `HorizontalRule`, `LinkReference`. Probably `HTMLBlock` too, once Obsidian's behavior there is checked.
  - Kept: `HTMLTag`, which parses `<url>` autolinks.
  - GFM stays off, so bare URLs are not links.
- **Obsidian-specific extensions only where they change extraction:**
  - wikilinks and embeds (one line, `\` does not escape)
  - `$`/`$$` math (`$` does not open before a digit or a space; `\$` escapes)
  - frontmatter, which opens on a first line of exactly `---` and does not count if never closed
  - `%%` comments, a post-pass outside code nodes, because a comment pairs its markers across container boundaries
- **Reference for Obsidian's behaviour:** `quartz-community/remark-obsidian`, which is tested against Obsidian 1.14.
- **Lezer quirk:** `[@key]` parses as a `Link` with no `URL` child. The scanner treats such a link as text, and the Pandoc grammar reads the text ranges.
- **Retired:** `scanDocumentCitations`, `maskExclusions` and `maskWikilinks` leave the index and export paths. The editor's single-line lookup (`editor-lookup.ts`) stays synchronous on the main thread.

### Who owns what

- **The worker is a stateless parser.** It is a new embedded worker, separate from ZoteroReads, and long-lived from layout-ready. On failure it restarts with backoff, and there is no main-thread fallback. Requests are `{path, generation, text}` in and one file's record out.
- **The renderer owns everything else:**
  - intake: `changed` text, `deleted`, `rename`, and the backfill walk through `cachedRead`
  - generations: a later `changed` makes an in-flight result for that path stale
  - the IndexedDB store, with the renderer as the only writer
  - in-memory reverse maps rebuilt from records: citekey to files, and Annotation Indexed Key to `{path, occurrence}`
  - The backfill keeps a bounded number of requests in flight.

### The store

- **Record shape.** One record per file: `{path, mtime, size, scannerRevision, citekeys, wikilinks, annotations, malformedAnnotationCitations}`.
- **Versioning.** `SCHEMA_VERSION` 2 discards the old records once. After that, a grammar fix bumps `scannerRevision` instead. Stale records keep serving until the backfill rescans them, the same way an mtime or size mismatch is handled.
- **Clearing.** Reset Citation Index clears the store.

### Resolution and membership

- **Lookup on demand.** `CitationLookupRequest` gains `annotationKeys`. ZoteroReads answers them against the published revision as `{parent Item Indexed Key, citekey}` or missing. Occurrences stay raw.
- **New choice.** **Annotation Citations** joins Pandoc Citations and Wikilink Citations as a Document Citation Set choice, on by default.
- **Export.** Pandoc export reads the worker's parse. Export drops each worker-reported `%%` comment, preserving a blank line for whole-line block comments and joining the surrounding text for inline comments. What export emits for an Annotation Citation is left to a follow-up issue linked to #1678. Until then export leaves the link untouched.

### Evidence

- **Tests.**
  - `createCitationIndexHarness` stays the main seam, with an in-process twin of the parse worker, as ZoteroReads already has.
  - A conformance table, text in and occurrences out, covers the parse rules, with cases from `remark-obsidian`'s parity corpus.
  - One end-to-end smoke test runs the real worker.
  - The grammar fix gets a scaling test: doubling the citation count must not quadruple the time.
- **Performance gate.** A committed benchmark (10k, 100k and 1M characters; dense and sparse; with and without links) must show:
  - linear parse time
  - under about 100 ms in the worker for a 1M-character note
  - no backfill regression on the fixture vault
  - under 2 ms of renderer work (post plus apply) per `changed` at 100k characters

## Considered Options

- **Reuse the metadata cache.** Impossible: it drops every `zotero:` link. Its `referenceLinks` keep only reference-style definitions, which ZotLit never writes.
- **Hand-rolled single pass:** today's masks fused with link extraction. Cheapest, but CommonMark nesting would still be approximate and patched one edge case at a time.
- **Trimmed micromark/mdast,** the family Obsidian uses. Closest to Obsidian's output, but a new and heavier dependency.
- **Parse in the ZoteroReads worker.** A backfill would queue behind SQLite statements and Item search, which ADR 0073 holds to p99 ≤ 16 ms and max ≤ 32 ms, and it would fail with them.
- **Worker owns the backfill and store, reading files through Node `fs`.** This bypasses the vault adapter and `cachedRead`, and makes the store two-writer or a mirror. The renderer cost it saves is one read and one post per file.
- **Include `%%` with a context flag.** Rejected with the principle above: a comment removes text from the document.
- **Preload every Annotation-to-parent mapping into the snapshot.** Publish time and worker memory would grow with the annotation count, mostly for annotations no note cites.
- **Store the parent Item at scan time.** A moved Annotation would stay stale until the note is touched.

## Consequences

- **The citation sidebars become async on first open.** References, Cited By and In-text Citation Rendering wait for the parse result of a document that has just changed. Persisted records cover cold start and worker restarts.
- **Memory and bundle.** An extra worker costs about 18 MiB of baseline heap (measured in ADR 0072). The worker bundle carries lezer.
- **Wikilink Citations change behavior.** A wikilink inside `%%` no longer counts as a citation.
- **Annotation embeds are indexed before they render.** `![](…)` is indexed now. How it renders stays with #1678.
