# The Sort Index and Page Label are computed in Obsidian from a port of Zotero's text structure

Only Zotero's reader computes a PDF Annotation's Sort Index and Page Label; the backend stores whatever string the Zotero Local API receives, and the reader recomputes the Sort Index only when the user moves that mark. The offset field is the index of the nearest glyph in the page's Structured Characters, so it depends on Zotero's own pdf.js extraction, dedupe, and line grouping, and the Page Label comes from a heuristic over the same characters. Obsidian's bundled pdf.js already exposes per-glyph rectangles through `includeChars`, so ZotLit carries a port of the `structure.js` and `page-label.js` modules from `zotero/pdf.js` (Apache-2.0, pinned to one reader commit in the file header), feeds it Obsidian's glyphs through four filter rules — drop space glyphs, drop control characters, NFKD-normalize `c`, keep `u` raw — and computes both values in Obsidian at creation. Normalizing `c` means Zotero's own `normalizeChar`: NFKD, then the 22-entry table that recomposes the common accented Latin letters, because plain NFKD leaves a decomposed `è` where Zotero writes a precomposed one. A page with no characters gets offset `000000` and the geometric `top`, as Zotero's reader does. A committed golden test compares the port's per-page characters and Page Labels index for index against Zotero's fork on the fixture PDFs; the port is refreshed only when that test fails against a newer Zotero.

## Considered Options

- **Ask the running Zotero reader for `getAnnotationMeta`** (rejected): it needs a reader open on that Attachment at the moment of creation, which is the exception on a path whose point is annotating in Obsidian, and an inbound channel to the Companion that ADR 0036 refused.
- **Emit offset `000000` always** (rejected): the write succeeds, but every ZotLit mark sorts above every Zotero mark on its page, in Zotero's sidebar, item pane, note-from-annotations, and ZotLit's own Annotation View, because the offset field outranks the top field.
- **Catalog page labels only** (rejected): a journal article with no `/PageLabels` shows `1` where Zotero shows `233`, and the label reaches citations.
- **Port the text structure and the label heuristic, guarded by a parity test** (chosen).

## Consequences

- Structured Characters are computed lazily per page and memoized per Reader Session; the label pass runs in idle time after the document loads and is awaited only when a creation arrives first.
- A Sort Index is never rewritten after creation. Colour and comment edits send none; ordering repairs are left to Zotero's reader, which recomputes on drag.
- Parity means parity with the pinned fork. Drift across Zotero versions is accepted, as Zotero's own import worker already produces it.
- The parity fixture needs PDFs beyond `rougier-2014`: one that enters the rotation, ligature, or multi-column branches of the line grouping, and one scanned page with no text layer.

## Amendment: a Geometry Edit recomputes the Sort Index

ZotLit computes the Sort Index at creation and recomputes it on a Geometry Edit, the one edit Zotero's own reader recomputes it for. The new value comes from the moved position through the same text structure call a creation makes, from the unrounded geometry, and travels in the same patch as the position and, for a highlight or underline, the quoted text. The Page Label is not recomputed, because a Geometry Edit keeps the page. This replaces the consequence "A Sort Index is never rewritten after creation": colour and comment edits still send none, and a Geometry Edit is now the one write after creation that sends one.
