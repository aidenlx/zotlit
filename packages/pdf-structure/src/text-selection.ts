// Zotero's reader-side text selection: a DOM Selection mapped onto a page's
// Structured Characters, and the rectangles and text a highlight or an
// underline stores for the characters it covers.
//
// Ported from zotero/reader `src/pdf/selection.js`, `pdf-view.js` and
// `native-text-selection.js` at 132bb787937a540a09513415fd507654eb0e88f9.
// pdf-reader is copyright © 2020–2021 Corporation for Digital Scholarship,
// Vienna, Virginia, USA, and distributed under the GNU Affero General Public
// License v3; ZotLit's AGPL-3.0-or-later grant lets this port be distributed
// under AGPL v3.

import type { Rect, StructuredChar, StructuredPage } from "@/chars";
import {
  alignTextUnits,
  buildReaderUnitMap,
  getNormalizedUnits,
  selectionTextMatches,
} from "@/vendor/native-text-selection-map.js";

/** The rectangles and the text of a run of characters on one page. */
export interface TextRange {
  /** One rectangle per line, rounded to three decimals. */
  readonly rects: Rect[];
  readonly text: string;
}

/**
 * One page a DOM text selection reaches, read off that page's text layer.
 * Offsets count UTF-16 code units into `layerText`.
 */
export interface TextLayerSelection {
  readonly pageIndex: number;
  /** The text layer's whole text, in document order. */
  readonly layerText: string;
  /** Where the selection starts, or `null` when it starts on an earlier page. */
  readonly start: number | null;
  /** Where the selection ends, or `null` when it ends on a later page. */
  readonly end: number | null;
  /**
   * The selection's boxes on this page in PDF points, taken from its text
   * nodes alone. Only the fallback reads them.
   */
  readonly rects: readonly Rect[];
}

/** A DOM text selection, page by page. */
export interface TextSelection {
  /** `Selection.toString()`, which the text check compares against. */
  readonly text: string;
  readonly pages: readonly TextLayerSelection[];
}

/** What a text selection creates: a Zotero position and its quoted text. */
export interface SelectedText {
  readonly pageIndex: number;
  readonly rects: Rect[];
  /** The second page's rectangles, for a quote that ran over a page break. */
  readonly nextPageRects?: Rect[];
  readonly text: string;
}

/**
 * One rectangle per line: the union of the line's `inlineRect`s.
 *
 * @see https://github.com/zotero/reader/blob/132bb787937a540a09513415fd507654eb0e88f9/src/pdf/selection.js#L197-L219
 */
function rectsFromChars(chars: readonly StructuredChar[]): Rect[] {
  const lineRects: Rect[] = [];
  let current: [number, number, number, number] | null = null;
  for (const { inlineRect, lineBreakAfter } of chars) {
    current ??= [...inlineRect];
    current = [
      Math.min(current[0], inlineRect[0]),
      Math.min(current[1], inlineRect[1]),
      Math.max(current[2], inlineRect[2]),
      Math.max(current[3], inlineRect[3]),
    ];
    if (lineBreakAfter) {
      lineRects.push(current);
      current = null;
    }
  }
  if (current) lineRects.push(current);
  return lineRects;
}

/**
 * The characters' text: a space after a word, a line and a paragraph, and no
 * discretionary hyphen.
 *
 * @see https://github.com/zotero/reader/blob/132bb787937a540a09513415fd507654eb0e88f9/src/pdf/selection.js#L221-L237
 */
function textFromChars(chars: readonly StructuredChar[]): string {
  const text: string[] = [];
  for (const char of chars) {
    if (char.ignorable) continue;
    text.push(char.c);
    if (char.spaceAfter || char.lineBreakAfter) text.push(" ");
    // OCRed PDFs can make every line a paragraph of its own.
    if (char.paragraphBreakAfter) text.push(" ");
  }
  return text.join("").trim();
}

/**
 * The range between two character boundaries, from either end. Offsets run
 * from `0` to `chars.length`: a boundary can sit after the last character.
 *
 * @see https://github.com/zotero/reader/blob/132bb787937a540a09513415fd507654eb0e88f9/src/pdf/selection.js#L239-L259
 */
export function textRange(
  chars: readonly StructuredChar[],
  anchorOffset: number,
  headOffset: number,
): TextRange {
  if (anchorOffset === headOffset) return { rects: [], text: "" };
  const rangeChars = chars.slice(
    Math.min(anchorOffset, headOffset),
    Math.max(anchorOffset, headOffset),
  );
  const round = (value: number) => Number.parseFloat(value.toFixed(3));
  return {
    rects: rectsFromChars(rangeChars).map(
      ([x1, y1, x2, y2]) =>
        [round(x1), round(y1), round(x2), round(y2)] as const,
    ),
    text: textFromChars(rangeChars),
  };
}

const intersects = (a: Rect, b: Rect): boolean =>
  !(b[0] > a[2] || b[2] < a[0] || b[1] > a[3] || b[3] < a[1]);

const centreOf = ([x1, y1, x2, y2]: Rect): Rect => {
  const x = x1 + (x2 - x1) / 2;
  const y = y1 + (y2 - y1) / 2;
  return [x, y, x, y];
};

/**
 * The characters a highlight's rectangles cover: from the first character
 * whose centre falls in the first rectangle to the last whose centre falls in
 * the last. `null` where that leaves no character.
 *
 * @see https://github.com/zotero/reader/blob/132bb787937a540a09513415fd507654eb0e88f9/src/pdf/selection.js#L140-L175
 */
export function offsetsByRects(
  chars: readonly StructuredChar[],
  rects: readonly Rect[],
): { from: number; to: number } | null {
  const [first] = rects;
  const last = rects.at(-1);
  if (!first || !last || !chars.length) return null;
  let from = chars.findIndex((char) => intersects(centreOf(char.rect), first));
  if (from === -1) from = Number.POSITIVE_INFINITY;
  const to =
    chars.findLastIndex((char) => intersects(centreOf(char.rect), last)) + 1;
  return from > to ? null : { from, to };
}

/**
 * For every code-unit boundary of `text`, the count of normalised units
 * before it. A boundary inside a surrogate pair counts as the one before it.
 *
 * @see https://github.com/zotero/reader/blob/132bb787937a540a09513415fd507654eb0e88f9/src/pdf/native-text-selection.js#L60-L90
 */
function normalizedPrefix(text: string): { units: string[]; prefix: number[] } {
  const units: string[] = [];
  const prefix = Array.from<number>({ length: text.length + 1 }).fill(0);
  let source = 0;
  for (const character of text) {
    for (let i = 1; i < character.length; i++)
      prefix[source + i] = units.length;
    units.push(...getNormalizedUnits(character));
    source += character.length;
    prefix[source] = units.length;
  }
  return { units, prefix };
}

/** A page's part of a selection, as character offsets on that page. */
interface PageRange {
  readonly pageIndex: number;
  readonly chars: readonly StructuredChar[];
  readonly from: number;
  readonly to: number;
}

/**
 * The selection's ends on one page, found by aligning the text layer's text
 * with the page's characters. A page the selection runs through keeps every
 * character. `null` where an end falls outside the alignment.
 *
 * @see https://github.com/zotero/reader/blob/132bb787937a540a09513415fd507654eb0e88f9/src/pdf/native-text-selection.js#L45-L57
 */
function mappedRange(
  layer: TextLayerSelection,
  chars: readonly StructuredChar[],
): PageRange | null {
  const dom = normalizedPrefix(layer.layerText);
  const reader = buildReaderUnitMap(chars);
  const toReader = alignTextUnits(dom.units, reader.readerUnits);
  // `at` indexes `layerText`, so its prefix entry always exists; the
  // alignment's own entry may not, and then no offset stands for it.
  const offset = (at: number, ends: readonly number[]) => {
    const unit = toReader[dom.prefix[at]!];
    return unit === undefined ? undefined : ends[unit];
  };
  const from =
    layer.start === null ? 0 : offset(layer.start, reader.readerStartOffsets);
  const to =
    layer.end === null
      ? chars.length
      : offset(layer.end, reader.readerEndOffsets);
  if (from === undefined || to === undefined) return null;
  return { pageIndex: layer.pageIndex, chars, from, to };
}

/**
 * The selection placed by its text-node boxes instead: from the first
 * character of the first page they cover to the last of the last page.
 *
 * @see https://github.com/zotero/reader/blob/132bb787937a540a09513415fd507654eb0e88f9/src/pdf/native-text-selection.js#L492-L530
 */
function rangesByRects(
  layers: readonly {
    layer: TextLayerSelection;
    chars: readonly StructuredChar[];
  }[],
): PageRange[] | null {
  const covered = layers.flatMap(({ layer, chars }) => {
    const offsets = offsetsByRects(chars, layer.rects);
    return offsets && offsets.from !== offsets.to
      ? [{ index: layer.pageIndex, ...offsets }]
      : [];
  });
  const first = covered[0];
  const last = covered.at(-1);
  if (!first || !last) return null;
  return layers
    .filter(
      ({ layer }) =>
        layer.pageIndex >= first.index && layer.pageIndex <= last.index,
    )
    .map(({ layer, chars }) => ({
      pageIndex: layer.pageIndex,
      chars,
      from: layer.pageIndex === first.index ? first.from : 0,
      to: layer.pageIndex === last.index ? last.to : chars.length,
    }));
}

/**
 * What a DOM text selection creates, or `null` for one the page's characters
 * cannot place.
 *
 * The text layer's text is aligned with the characters first, and the result
 * must quote what the DOM selected; else the selection's own boxes place it,
 * under the same check. Zotero's mobile reader drops a selection that fails
 * both, and so does this.
 *
 * Zotero keeps at most two pages: the second one's rectangles become
 * `nextPageRects` and its text joins the first's with one space. A page the
 * selection covers no character of is left out, and a second page that is not
 * the next one is dropped.
 *
 * @param selection the DOM selection, read page by page off the text layers.
 * @param pages the Structured Characters of every page the selection reaches.
 * @see https://github.com/zotero/reader/blob/132bb787937a540a09513415fd507654eb0e88f9/src/pdf/native-text-selection.js#L184-L240
 * @see https://github.com/zotero/reader/blob/132bb787937a540a09513415fd507654eb0e88f9/src/pdf/pdf-view.js — `_getAnnotationFromSelectionRanges`
 */
export function selectText(
  selection: TextSelection,
  pages: ReadonlyMap<number, StructuredPage>,
): SelectedText | null {
  const layers = selection.pages
    .toSorted((a, b) => a.pageIndex - b.pageIndex)
    .flatMap((layer) => {
      const page = pages.get(layer.pageIndex);
      return page ? [{ layer, chars: page.chars }] : [];
    });
  if (!layers.length) return null;

  const quoted = (ranges: readonly PageRange[] | null) => {
    if (!ranges?.length) return null;
    const placed = ranges.map((range) => ({
      pageIndex: range.pageIndex,
      ...textRange(range.chars, range.from, range.to),
    }));
    const text = placed.map((range) => range.text).join("\n");
    return selectionTextMatches(selection.text, text) ? placed : null;
  };
  const mapped = layers.map(({ layer, chars }) => mappedRange(layer, chars));
  const allMapped = mapped.every((range): range is PageRange => range !== null);
  const placed =
    quoted(allMapped ? mapped : null) ?? quoted(rangesByRects(layers));
  if (!placed) return null;

  const [first, spilled] = placed.filter((range) => range.rects.length > 0);
  if (!first) return null;
  const next = spilled?.pageIndex === first.pageIndex + 1 ? spilled : undefined;
  return {
    pageIndex: first.pageIndex,
    rects: first.rects,
    ...(next && { nextPageRects: next.rects }),
    text: next ? `${first.text} ${next.text}` : first.text,
  };
}
