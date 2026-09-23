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
import type { PdfRectsPosition } from "@/sort-index";
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

/** Which end of a highlight's range a drag moves; the other is the anchor. */
export type RangeEnd = "start" | "end";

/** A point in PDF page space on one page. */
export interface PagePoint {
  readonly pageIndex: number;
  readonly x: number;
  readonly y: number;
}

/**
 * One key press on an end of a highlight's range: a character back or on, or
 * a line up or down.
 */
export type RangeStep = "left" | "right" | "up" | "down";

/**
 * One end of a highlight's range dragged to a point, or stepped from the
 * keyboard.
 */
export type RangeAdjustment = {
  /** The highlight or underline position as stored. */
  readonly position: PdfRectsPosition;
  readonly end: RangeEnd;
} & (
  | {
      /** Where the pointer is, on the position's page or the one after it. */
      readonly point: PagePoint;
    }
  | { readonly step: RangeStep }
);

/**
 * The distance between two rects, zero where they touch or overlap.
 *
 * @see https://github.com/zotero/reader/blob/132bb787937a540a09513415fd507654eb0e88f9/src/pdf/selection.js#L3-L37
 */
function rectsDist(
  [ax1, ay1, ax2, ay2]: Rect,
  [bx1, by1, bx2, by2]: Rect,
): number {
  const left = bx2 < ax1;
  const right = ax2 < bx1;
  const bottom = by2 < ay1;
  const top = ay2 < by1;
  if (top && left) return Math.hypot(ax1 - bx2, ay2 - by1);
  if (left && bottom) return Math.hypot(ax1 - bx2, ay1 - by2);
  if (bottom && right) return Math.hypot(ax2 - bx1, ay1 - by2);
  if (right && top) return Math.hypot(ax2 - bx1, ay2 - by1);
  if (left) return ax1 - bx2;
  if (right) return bx1 - ax2;
  if (bottom) return ay1 - by2;
  if (top) return by1 - ay2;
  return 0;
}

/**
 * The character boundary nearest a point: before the closest character, or
 * after it once the point passes its middle along the text's direction.
 *
 * @see https://github.com/zotero/reader/blob/132bb787937a540a09513415fd507654eb0e88f9/src/pdf/selection.js#L39-L51
 * @see https://github.com/zotero/reader/blob/132bb787937a540a09513415fd507654eb0e88f9/src/pdf/selection.js#L80-L140 — `getRangeBySelection`, the `head` branch
 */
function offsetAtPoint(
  chars: readonly StructuredChar[],
  { x, y }: PagePoint,
): number {
  let closest = 0;
  let distance = Number.POSITIVE_INFINITY;
  for (const [index, char] of chars.entries()) {
    const d = rectsDist(char.rect, [x, y, x, y]);
    if (d < distance) {
      distance = d;
      closest = index;
    }
  }
  const { rotation, rect } = chars[closest]!;
  const midX = rect[0] + (rect[2] - rect[0]) / 2;
  const midY = rect[1] + (rect[3] - rect[1]) / 2;
  const past =
    (!rotation && x > midX) ||
    (rotation === 90 && y > midY) ||
    (rotation === 180 && x < midX) ||
    (rotation === 270 && y < midY);
  return past ? closest + 1 : closest;
}

/**
 * The offset a line down from `offset`: the character on the next line
 * closest to the one at `offset`, or the page's end from its last line.
 *
 * @see https://github.com/zotero/reader/blob/132bb787937a540a09513415fd507654eb0e88f9/src/pdf/selection.js — `getNextLineClosestOffset`
 */
function nextLineOffset(
  chars: readonly StructuredChar[],
  offset: number,
): number | null {
  const lineEnd = chars.findIndex(
    (char, index) => index >= offset && char.lineBreakAfter,
  );
  if (lineEnd === -1 || lineEnd === chars.length - 1) return chars.length;
  const nextEnd = chars.findIndex(
    (char, index) => index > lineEnd && char.lineBreakAfter,
  );
  return closestOnLine(chars, chars[offset]!.rect, [lineEnd + 1, nextEnd]);
}

/**
 * The offset a line up from `offset`: the character on the previous line
 * closest to the one at `offset`, or the page's start from its first line.
 *
 * @see https://github.com/zotero/reader/blob/132bb787937a540a09513415fd507654eb0e88f9/src/pdf/selection.js — `getPrevLineClosestOffset`
 */
function previousLineOffset(
  chars: readonly StructuredChar[],
  offset: number,
): number | null {
  const at = offset === chars.length ? offset - 1 : offset;
  const previousEnd = chars.findLastIndex(
    (char, index) => index < at && char.lineBreakAfter,
  );
  if (previousEnd === -1) return 0;
  const previousStart =
    chars.findLastIndex(
      (char, index) => index < previousEnd && char.lineBreakAfter,
    ) + 1;
  return closestOnLine(chars, chars[at]!.rect, [previousStart, previousEnd]);
}

/** The first offset in `start`–`end`, inclusive, closest to a rect. */
function closestOnLine(
  chars: readonly StructuredChar[],
  rect: Rect,
  [start, end]: readonly [number, number],
): number | null {
  let closest: number | null = null;
  let distance = Number.POSITIVE_INFINITY;
  for (let index = start; index <= end; index++) {
    const d = rectsDist(chars[index]!.rect, rect);
    if (d < distance) {
      distance = d;
      closest = index;
    }
  }
  return closest;
}

/**
 * The boundary one key press moves a range's head to, counted through both
 * pages as {@link adjustRange} counts them. Past a page's end, the head lands
 * after the next page's first character, and before a page's start, before
 * the previous page's last, as Zotero's reader steps across a page.
 *
 * @param pages the Annotation's page and the one after it.
 * @see https://github.com/zotero/reader/blob/132bb787937a540a09513415fd507654eb0e88f9/src/pdf/selection.js — `getModifiedSelectionRanges`
 */
function steppedHead(
  head: number,
  step: RangeStep,
  [first, next]: readonly [
    readonly StructuredChar[],
    readonly StructuredChar[],
  ],
): number {
  const onNext = head > first.length;
  const chars = onNext ? next : first;
  const base = onNext ? first.length : 0;
  const local = head - base;
  if (step === "left" || (step === "up" && local === 0)) return head - 1;
  if (step === "up") {
    const moved = previousLineOffset(chars, local);
    return moved === null ? head : base + moved;
  }
  if (local === chars.length) {
    // Onto the next page's first character, from the first page only.
    return !onNext && next.length ? head + 1 : head;
  }
  if (step === "right") return head + 1;
  const moved = nextLineOffset(chars, local);
  return moved === null ? head : base + moved;
}

/**
 * A highlight or underline with one end dragged to a point, or stepped from
 * the keyboard; `null` where no range can be placed.
 *
 * The ends are read off the stored rects as Zotero's reader reads them: the
 * start at the first character whose centre falls in the first rect, the end
 * after the last whose centre falls in the last rect, on the next page when
 * the range spilled onto it. The other end stays where it is. A dragged end
 * moves to the character boundary nearest the point; a stepped one moves one
 * character back or on, or to the closest character a line up or down.
 *
 * Where Zotero's reader differs, this keeps the stored shape:
 * - An end dragged onto or past the anchor stops one character short of it,
 *   so the range keeps one character; Zotero turns the range round instead.
 *   A step that would leave no character is refused, as Zotero refuses it.
 * - The range stays on the Annotation's page and the page after it, and the
 *   start stays on the Annotation's page, so `pageIndex` never changes. A
 *   point on any other page, a start moved onto the next page, and an end or
 *   a start stepped off the pair, are `null`.
 * - An end before the next page's first character stores no `nextPageRects`.
 * - An end that lands on the characters the stored rects cover proposes
 *   those rects, so it changes nothing.
 *
 * @param pages the Structured Characters of the Annotation's page and, where
 *   the range, the point, or a step reaches it, the page after.
 * @see https://github.com/zotero/reader/blob/132bb787937a540a09513415fd507654eb0e88f9/src/pdf/selection.js — `getSelectionRangesByPosition`, `getModifiedSelectionRanges`, `getSelectionRanges`
 * @see https://github.com/zotero/reader/blob/132bb787937a540a09513415fd507654eb0e88f9/src/pdf/pdf-view.js — `_getAnnotationFromSelectionRanges`, `_handleKeyDown`
 */
export function adjustRange(
  adjustment: RangeAdjustment,
  pages: ReadonlyMap<number, StructuredPage>,
): SelectedText | null {
  const { position, end } = adjustment;
  const { pageIndex } = position;
  const point = "point" in adjustment ? adjustment.point : null;
  if (
    point &&
    point.pageIndex !== pageIndex &&
    point.pageIndex !== pageIndex + 1
  )
    return null;
  const first = pages.get(pageIndex)?.chars ?? [];
  const onFirst = offsetsByRects(first, position.rects);
  if (!onFirst) return null;
  const next = pages.get(pageIndex + 1)?.chars ?? [];
  const onNext = position.nextPageRects
    ? offsetsByRects(next, position.nextPageRects)
    : null;

  // Boundaries count through both pages: the next page's offset `k` is
  // `first.length + k`.
  const from = onFirst.from;
  const to = onNext ? first.length + onNext.to : onFirst.to;
  let start = from;
  let stop = to;
  if (point) {
    let head: number;
    if (point.pageIndex === pageIndex) head = offsetAtPoint(first, point);
    else if (next.length) head = first.length + offsetAtPoint(next, point);
    else return null;
    if (end === "end") stop = Math.max(head, from + 1);
    else {
      if (head >= first.length) return null;
      start = Math.min(head, to - 1);
    }
  } else if ("step" in adjustment) {
    const head = steppedHead(end === "end" ? to : from, adjustment.step, [
      first,
      next,
    ]);
    if (end === "end") {
      if (head <= from) return null;
      stop = head;
    } else {
      if (head < 0 || head >= first.length || head >= to) return null;
      start = head;
    }
  }

  // The same characters keep the rects as stored, which may be drawn a hair
  // off the characters' own, so a still drag proposes no change.
  const stored =
    start === from && stop === to
      ? { rects: [...position.rects], nextPageRects: position.nextPageRects }
      : null;
  const onPage = textRange(first, start, Math.min(stop, first.length));
  const spill =
    stop > first.length ? textRange(next, 0, stop - first.length) : null;
  if (!onPage.rects.length) return null;
  return spill?.rects.length
    ? {
        pageIndex,
        rects: stored?.rects ?? onPage.rects,
        nextPageRects: stored?.nextPageRects
          ? [...stored.nextPageRects]
          : spill.rects,
        text: `${onPage.text} ${spill.text}`,
      }
    : { pageIndex, rects: stored?.rects ?? onPage.rects, text: onPage.text };
}
