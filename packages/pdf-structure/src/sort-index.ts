// Zotero's reader-side Sort Index, computed from a page's Structured
// Characters and the rectangle an Annotation covers.

import type { Rect, StructuredChar, StructuredPage } from "@/chars";

/** Highlight, underline, note and image positions. */
export interface PdfRectsPosition {
  readonly pageIndex: number;
  readonly rects: readonly Rect[];
  readonly nextPageRects?: readonly Rect[];
}

/** Ink positions, which carry stroke points instead of rectangles. */
export interface PdfInkPosition {
  readonly pageIndex: number;
  readonly paths: readonly (readonly number[])[];
  readonly width?: number;
}

export type PdfPosition = PdfInkPosition | PdfRectsPosition;

const hasRects = (position: PdfPosition): position is PdfRectsPosition =>
  "rects" in position && position.rects.length > 0;

/**
 * The rect with the largest index 2 — `x2` under the `[x1, y1, x2, y2]`
 * convention the rest of the algorithm uses. Zotero's comment says `y2`; the
 * code sorts on index 2 and the code is the behaviour, so the port follows it.
 * `Array.prototype.sort` is stable, so ties keep the earlier rect.
 *
 * @see https://github.com/zotero/reader/blob/132bb787937a540a09513415fd507654eb0e88f9/src/pdf/selection.js#L394-L397
 */
function topMostRect(position: PdfRectsPosition): Rect {
  return position.rects.slice().sort((a, b) => b[2] - a[2])[0]!;
}

/**
 * The bounding box of every path point, which is what ink falls back to when
 * the position carries no rectangles.
 *
 * @see https://github.com/zotero/reader/blob/132bb787937a540a09513415fd507654eb0e88f9/src/pdf/lib/utilities.js#L44-L59
 */
function pathsBoundingRect(paths: readonly (readonly number[])[]): Rect {
  const [x = 0, y = 0] = paths[0] ?? [];
  const rect: [number, number, number, number] = [x, y, x, y];
  for (const path of paths) {
    for (let i = 0; i < path.length - 1; i += 2) {
      rect[0] = Math.min(rect[0], path[i]!);
      rect[1] = Math.min(rect[1], path[i + 1]!);
      rect[2] = Math.max(rect[2], path[i]!);
      rect[3] = Math.max(rect[3], path[i + 1]!);
    }
  }
  return rect;
}

/** Zero when the rectangles overlap or touch, else the gap between them. */
function rectsDist(a: Rect, b: Rect): number {
  const [ax1, ay1, ax2, ay2] = a;
  const [bx1, by1, bx2, by2] = b;
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
 * The index of the character nearest the rectangle. The comparison is strictly
 * `<`, so the first character that touches the rectangle wins.
 *
 * @see https://github.com/zotero/reader/blob/132bb787937a540a09513415fd507654eb0e88f9/src/pdf/selection.js#L37-L49
 */
function closestOffset(chars: readonly StructuredChar[], rect: Rect): number {
  let dist = Number.POSITIVE_INFINITY;
  let index = 0;
  for (const [i, char] of chars.entries()) {
    const distance = rectsDist(char.rect, rect);
    if (distance < dist) {
      dist = distance;
      index = i;
    }
  }
  return index;
}

/** The rectangle a Sort Index measures, before any rounding for the write. */
export function sortIndexRect(position: PdfPosition): Rect {
  return hasRects(position)
    ? topMostRect(position)
    : pathsBoundingRect("paths" in position ? position.paths : []);
}

const field = (value: number, width: number): string =>
  value.toString().slice(0, width).padStart(width, "0");

/**
 * The Sort Index Zotero's reader would write for this position: the page
 * index, the offset of the nearest glyph, and the distance in points from the
 * page's top edge, floored and clamped to zero.
 *
 * A page with no characters keeps offset `0` and still reports the geometric
 * `top`, as Zotero's reader does — the caller decides whether that is worth a
 * log line.
 *
 * @see https://github.com/zotero/reader/blob/132bb787937a540a09513415fd507654eb0e88f9/src/pdf/selection.js#L399-L419
 */
export function computeSortIndex(
  page: StructuredPage,
  position: PdfPosition,
): string {
  const rect = sortIndexRect(position);
  const offset = page.chars.length ? closestOffset(page.chars, rect) : 0;
  const pageHeight = page.viewBox[3] - page.viewBox[1];
  const top = Math.max(pageHeight - rect[3], 0);

  return [
    field(position.pageIndex, 5),
    field(offset, 6),
    field(Math.floor(top), 5),
  ].join("|");
}
