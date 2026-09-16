// The text selection a mark is created from: the pages it reaches, the boxes it
// covers on each in PDF points, and the text it quotes.
//
// The reader's own text layer is the only thing that produces these rectangles,
// and it is read exactly as the browser laid it out — ZotLit never re-renders it.
//
// @see https://github.com/aidenlx/zotlit/issues/1150
import { getLogger } from "@/lib/log";

import type { OverlayPageView } from "./render";

const logger = getLogger("pdf-annotation-editor");

/** A box in client coordinates, as `Range.getClientRects()` answers them. */
export interface ClientBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** `[x1, y1, x2, y2]` in PDF points, the units a Zotero position is stored in. */
export type PdfRect = readonly [number, number, number, number];

/** One page a selection reaches, as the reader has it laid out right now. */
export interface SelectionPage {
  pageIndex: number;
  /** The page element's own client rectangle. */
  box: ClientBox;
  /**
   * PDF.js `viewport.transform`: the PDF-point to viewport-pixel matrix. Its
   * inverse is what carries a client box back to PDF points, at any zoom and
   * under any page rotation.
   */
  transform: readonly number[];
  /** The selection's boxes on this page, in client coordinates. */
  rects: readonly ClientBox[];
  /** The selection's text on this page. */
  text: string;
}

/** A selection ready to be written, with its geometry unrounded. */
export interface CapturedSelection {
  pageIndex: number;
  rects: readonly PdfRect[];
  /** The second page's boxes, for a quote that ran over a page break. */
  nextPageRects?: readonly PdfRect[];
  /** The quoted text, trimmed, with a single space across the page break. */
  text: string;
}

/**
 * What one text selection creates, or `null` for a selection that quotes
 * nothing this reader can place.
 *
 * Zotero keeps at most two pages: the ranges are ordered by page and the first
 * two survive, the second one's boxes becoming `nextPageRects` and its text
 * joining the first's with a single space. A third page is dropped rather than
 * split into a second Annotation, which is what Zotero's own reader does.
 *
 * @see https://github.com/zotero/reader/blob/132bb787937a540a09513415fd507654eb0e88f9/src/pdf/pdf-view.js#L3378-L3400
 */
export function captureSelection(
  pages: readonly SelectionPage[],
): CapturedSelection | null {
  const ordered = pages
    .toSorted((a, b) => a.pageIndex - b.pageIndex)
    .map((page) => ({
      pageIndex: page.pageIndex,
      rects: pdfRectsOf(page),
      text: page.text.trim(),
    }))
    .filter((page) => page.rects.length > 0)
    .slice(0, 2);

  const [first, spilled] = ordered;
  if (!first) return null;
  // A quote runs over one page break, so the second page has to be the next
  // one; anything else is two selections the browser reported as one.
  const next = spilled?.pageIndex === first.pageIndex + 1 ? spilled : undefined;
  const text = [first.text, next?.text]
    .filter((part) => part !== undefined && part !== "")
    .join(" ");
  if (text === "") return null;

  return {
    pageIndex: first.pageIndex,
    rects: first.rects,
    ...(next && { nextPageRects: next.rects }),
    text,
  };
}

/**
 * The pages one range reaches, each carrying the part of the range that falls
 * inside it. A range clamped to a page answers that page's own text and its own
 * client rectangles, so a two-page quote is two entries rather than one.
 *
 * @param pages every page the reader has built, in any order.
 */
export function selectionPagesOf(
  range: Range,
  pages: readonly { pageIndex: number; view: OverlayPageView }[],
): SelectionPage[] {
  return pages.flatMap(({ pageIndex, view }) => {
    const clamped = clampToNode(range, view.div);
    if (!clamped) return [];
    const text = clamped.toString();
    return [
      {
        pageIndex,
        box: boxOf(view.div.getBoundingClientRect()),
        transform: view.viewport.transform,
        rects: [...clamped.getClientRects()].map((rect) => boxOf(rect)),
        text,
      },
    ];
  });
}

/**
 * The part of `range` that falls inside `node`, or `null` where none does.
 *
 * The boundary constants are read off the range itself rather than the global
 * `Range`, because the reader runs in pop-out windows where the global belongs
 * to another one.
 *
 * @see apps/obsidian/policies/popout-windows.md
 */
function clampToNode(range: Range, node: Node): Range | null {
  const within = range.cloneRange();
  within.selectNodeContents(node);
  if (range.compareBoundaryPoints(range.END_TO_START, within) >= 0) return null;
  if (range.compareBoundaryPoints(range.START_TO_END, within) <= 0) return null;

  const clamped = range.cloneRange();
  if (clamped.compareBoundaryPoints(clamped.START_TO_START, within) < 0) {
    clamped.setStart(within.startContainer, within.startOffset);
  }
  if (clamped.compareBoundaryPoints(clamped.END_TO_END, within) > 0) {
    clamped.setEnd(within.endContainer, within.endOffset);
  }
  return clamped.collapsed ? null : clamped;
}

function boxOf(rect: DOMRect): ClientBox {
  const { left, top, right, bottom } = rect;
  return { left, top, right, bottom };
}

/**
 * The selection's boxes on one page, clipped to the page box and carried back
 * into PDF points. A box that falls wholly outside the page, and one the clip
 * leaves with no area, both draw nothing.
 */
function pdfRectsOf({ box, transform, rects }: SelectionPage): PdfRect[] {
  const inverse = inverseTransform(transform);
  if (!inverse) {
    logger.debug("PDF page viewport carries no invertible transform");
    return [];
  }
  return rects.flatMap((rect) => {
    const clipped = clip(rect, box);
    if (!clipped) return [];
    const [x1, y1] = applyTransform(
      inverse,
      clipped.left - box.left,
      clipped.bottom - box.top,
    );
    const [x2, y2] = applyTransform(
      inverse,
      clipped.right - box.left,
      clipped.top - box.top,
    );
    return [
      [
        Math.min(x1, x2),
        Math.min(y1, y2),
        Math.max(x1, x2),
        Math.max(y1, y2),
      ] as const,
    ];
  });
}

function clip(rect: ClientBox, box: ClientBox): ClientBox | null {
  const clipped = {
    left: Math.max(rect.left, box.left),
    top: Math.max(rect.top, box.top),
    right: Math.min(rect.right, box.right),
    bottom: Math.min(rect.bottom, box.bottom),
  };
  const empty = clipped.right <= clipped.left || clipped.bottom <= clipped.top;
  return empty ? null : clipped;
}

/**
 * PDF.js's own matrix inverse, so a point converted here and one converted by
 * `convertToPdfPoint` agree to the bit.
 *
 * @returns `null` for a singular matrix, which no page viewport carries.
 * @see https://github.com/mozilla/pdf.js/blob/v5.3.31/src/shared/util.js — `Util.inverseTransform`
 */
function inverseTransform(
  transform: readonly number[],
): readonly number[] | null {
  const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = transform;
  const determinant = a * d - b * c;
  if (determinant === 0) return null;
  return [
    d / determinant,
    -b / determinant,
    -c / determinant,
    a / determinant,
    (c * f - e * d) / determinant,
    (e * b - f * a) / determinant,
  ];
}

function applyTransform(
  [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0]: readonly number[],
  x: number,
  y: number,
): [number, number] {
  return [a * x + c * y + e, b * x + d * y + f];
}
