// The text selection a mark is created from, read off each page's text layer:
// where it starts and ends in the layer's text, and the boxes its text covers.
// `PdfTextStructure.selectText` maps that onto the page's Structured
// Characters, which is where the stored rectangles and text come from.
//
// The reader's own text layer is read exactly as the browser laid it out —
// ZotLit never re-renders it.
//
// @see https://github.com/aidenlx/zotlit/issues/1150
import type { Rect, TextLayerSelection } from "@zotlit/pdf-structure";

import { getLogger } from "@/lib/log";

import type { OverlayPageView } from "./render";
import { pageContentBox } from "./surface";

const logger = getLogger("pdf-annotation-editor");

/** A box in client coordinates, as `Range.getClientRects()` answers them. */
export interface ClientBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** One page a selection reaches, as the reader has it laid out right now. */
export interface SelectionPage extends TextLayerSelection {
  /** The page's padding box: what its canvas and text layer fill. */
  box: ClientBox;
  /** The boxes of the selected text on this page, in client coordinates. */
  clientRects: readonly ClientBox[];
}

/**
 * The pages one range reaches, each carrying the part of the range that falls
 * inside its text layer. A page with no text layer, and one the range only
 * crosses outside its text, are left out.
 *
 * Only text nodes give boxes. A range across a page break also holds the
 * pages' canvas, annotation and end-of-content elements whole, and their boxes
 * would cover the whole page.
 *
 * @param pages every page the reader has built, in any order.
 */
export function selectionPagesOf(
  range: Range,
  pages: readonly { pageIndex: number; view: OverlayPageView }[],
): SelectionPage[] {
  return pages.flatMap(({ pageIndex, view }) => {
    const layer = view.div.querySelector(".textLayer");
    const clamped = layer && clampToNode(range, layer);
    if (!layer || !clamped) return [];
    const within = range.cloneRange();
    within.selectNodeContents(layer);
    const box = pageContentBox(view.div);
    const clientRects = textBoxesOf(clamped, layer);
    return [
      {
        pageIndex,
        layerText: layer.textContent ?? "",
        start:
          range.compareBoundaryPoints(range.START_TO_START, within) < 0
            ? null
            : textOffset(layer, clamped.startContainer, clamped.startOffset),
        end:
          range.compareBoundaryPoints(range.END_TO_END, within) > 0
            ? null
            : textOffset(layer, clamped.endContainer, clamped.endOffset),
        rects: pdfRectsOf(box, view.viewport.transform, clientRects),
        box,
        clientRects,
      },
    ];
  });
}

/** How many code units of the layer's text precede a boundary point. */
function textOffset(layer: Node, node: Node, offset: number): number {
  const before = layer.doc.createRange();
  before.setStart(layer, 0);
  before.setEnd(node, offset);
  return before.toString().length;
}

/**
 * The client boxes of the text the range holds, text node by text node.
 *
 * @see https://github.com/zotero/reader/blob/132bb787937a540a09513415fd507654eb0e88f9/src/pdf/native-text-selection.js#L572-L609
 */
function textBoxesOf(range: Range, layer: Node): ClientBox[] {
  const boxes: ClientBox[] = [];
  const walker = layer.doc.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!range.intersectsNode(node)) continue;
    const part = range.cloneRange();
    part.setStart(node, node === range.startContainer ? range.startOffset : 0);
    part.setEnd(
      node,
      node === range.endContainer ? range.endOffset : node.nodeValue!.length,
    );
    for (const rect of part.getClientRects()) boxes.push(boxOf(rect));
  }
  return boxes;
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
 *
 * @param transform PDF.js `viewport.transform`: the PDF-point to viewport-pixel
 *   matrix, whose inverse carries a box back at any zoom and rotation.
 */
function pdfRectsOf(
  box: ClientBox,
  transform: readonly number[],
  rects: readonly ClientBox[],
): Rect[] {
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
