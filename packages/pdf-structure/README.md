# @zotlit/pdf-structure

Zotero's PDF text structure, ported and pinned, so an Annotation created in
Obsidian carries the Sort Index and Page Label Zotero's own reader would write.

Only Zotero's reader computes those two values; the backend stores whatever the
Local API receives. The Sort Index's middle field is an **index** into the
page's Structured Characters, so it depends on Zotero's own glyph extraction,
dedupe and line grouping — which is why this package carries a copy of the
upstream modules rather than an equivalent of its own. See
[ADR 0040](../../apps/obsidian/docs/adr/0040-the-sort-index-and-page-label-are-computed-in-obsidian-from-a-port-of-zoteros-text-structure.md).

## What is inside

| Module | What it owns |
| --- | --- |
| `src/vendor/` | The pinned port: `structure.js`, `page-label.js`, `util.js` from `zotero/pdf.js`, and `native-text-selection-map.js` from `zotero/reader`, copied verbatim under a provenance header. |
| `src/chars.ts` | The adapter — Obsidian's per-glyph text content, filtered and normalised into the character stream the port consumes. |
| `src/sort-index.ts` | The reader's `getSortIndex`, its rectangle choice, and the `PPPPP\|OOOOOO\|TTTTT` format. |
| `src/text-selection.ts` | The reader's text selection: a DOM selection mapped onto Structured Characters, the line rectangles and text a highlight or an underline stores, and a stored range with one end dragged to a point or stepped from the keyboard. |
| `src/page-label.ts` | The printed-page heuristic, plus the reader's alignment to the previous Annotation. |
| `src/session.ts` | `PdfTextStructure` — one per Reader Session, memoizing Structured Characters per page. |
| `oracle/` | The golden oracle: Zotero's own modules, run from a local checkout in Node. |

## Using it

```ts
const structure = new PdfTextStructure(source);
// After the document loads, from idle time:
void structure.pageLabels();
// At creation:
const sortIndex = await structure.sortIndex(position);
const pageLabel = await structure.pageLabel(position.pageIndex, previous);
// From a text selection, read off the pages' text layers:
const selected = await structure.selectText({ text, pages });
// From a highlight's end handle, dragged to a page point:
const adjusted = await structure.adjustRange({ position, end: "end", point });
// Or its start stepped one character back from the keyboard:
const stepped = await structure.adjustRange({ position, end: "start", step: "left" });
```

`source` is a `PdfPageSource` the host builds over Obsidian's PDF seam.
`getTextItems` must request `{ includeChars: true }`, and `fontName` must be the
**base** font name (`page.commonObjs.get(item.fontName).name`), not pdf.js's
loaded name: the line grouping compares font names to decide paragraph breaks,
and two subsets that Zotero reads as one font would otherwise split.

## Parity

`src/parity.test.ts` runs Zotero's pinned modules in Node over the Fixture PDFs
and compares every Structured Character and Page Label index for index, then
reproduces the Sort Index strings Zotero itself wrote into the Fixture. It needs
a Zotero checkout; it skips with an explanation when there is none. See
[`AGENTS.md`](./AGENTS.md).
