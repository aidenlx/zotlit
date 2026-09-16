// Draws Zotero Annotations as one SVG overlay over an Obsidian PDF page.
import type { PDFPageView, PDFPageViewport } from "obsidian";

import type {
  PdfInkPosition,
  PdfRectsPosition,
  PdfTextPosition,
} from "@zotlit/db";

import { themeHook } from "@/lib/theme-hooks";
import type { AnnotationRecord } from "@/services/annotation-repository/service";

import "./style.css";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Obsidian's own state class, which ADR 0042 keeps as the mark's one mutable bit. */
const SELECTED_CLASS = "is-selected";

/** A PDF position, which is every position an Annotation Mark can be drawn from. */
type PdfPosition = PdfRectsPosition | PdfInkPosition | PdfTextPosition;

type PdfRect = PdfRectsPosition["rects"][number];

/** One Annotation to draw on one page, with its position already narrowed. */
export interface PdfPageAnnotation {
  annotation: AnnotationRecord;
  position: PdfPosition;
  /**
   * The rectangles this page draws, picked once at grouping — so a spilled-over
   * Annotation carries its own half of the quote on each of its two pages and no
   * primitive asks which page it is drawing. Empty for ink and free text, which
   * are drawn from the position itself.
   */
  rects: readonly PdfRect[];
}

/**
 * Parse nothing per page render: every position is narrowed once, when the
 * repository answers, and this keys the results by the page that draws them.
 *
 * A rects position carrying `nextPageRects` spilled over a page break and draws
 * on both of its pages, each from its own rectangles. A position that is not a
 * PDF position — an EPUB range, a snapshot selector, a shape Zotero added since
 * — draws nowhere and is dropped.
 */
export function groupAnnotationsByPage(
  annotations: readonly AnnotationRecord[],
): ReadonlyMap<number, readonly PdfPageAnnotation[]> {
  const placements = annotations.flatMap((annotation): PdfPagePlacement[] => {
    const { position } = annotation;
    switch (position.kind) {
      case "pdf-ink":
      case "pdf-text":
        return [
          { pageIndex: position.pageIndex, annotation, position, rects: [] },
        ];
      case "pdf-rects": {
        const { pageIndex, rects, nextPageRects } = position;
        const placement = { annotation, position };
        return nextPageRects?.length
          ? [
              { ...placement, pageIndex, rects },
              { ...placement, pageIndex: pageIndex + 1, rects: nextPageRects },
            ]
          : [{ ...placement, pageIndex, rects }];
      }
      default:
        return [];
    }
  });
  return Map.groupBy(placements, (placement) => placement.pageIndex);
}

/** The page view the overlay needs, so a test can stand one up as a literal. */
export type OverlayPageView = Pick<PDFPageView, "div"> & {
  viewport: Pick<
    PDFPageViewport,
    | "width"
    | "height"
    | "scale"
    | "rotation"
    | "userUnit"
    | "convertToViewportPoint"
  > &
    Partial<Pick<PDFPageViewport, "clone">>;
};

export interface AnnotationOverlayOptions {
  /** One page's placements, as {@link groupAnnotationsByPage} keyed them. */
  annotations: readonly PdfPageAnnotation[];
  /** The Indexed Keys drawn as selected. */
  selected?: ReadonlySet<string>;
}

/**
 * Rebuilds this page's overlay from the Annotations given, replacing whatever
 * it held. PDF.js `reset()` drops the overlay on every zoom, rotation and page
 * recycle, so the caller runs this again for each page-rendered event; a rebuild
 * is cheaper than keeping one alive across the wipe.
 *
 * The geometry is in PDF page units, taken from the viewport rebuilt at scale 1,
 * and the `viewBox` with `preserveAspectRatio="none"` maps it back onto the page
 * box the browser laid out — so the markup is the same at every zoom step and
 * the browser, not ZotLit, does the scaling.
 *
 * Annotation Marks are paint: the overlay is `aria-hidden` and takes no pointer
 * input, so native text selection, PDF links and the reader's toolbar all keep
 * working underneath.
 */
export function renderAnnotationOverlay(
  page: OverlayPageView,
  { annotations, selected }: AnnotationOverlayOptions,
): void {
  page.div.querySelector(`.${themeHook.pdfAnnotationOverlay}`)?.remove();

  const unitPage = toPageUnits(page);
  const document_ = page.div.ownerDocument;
  const overlay = document_.createElementNS(SVG_NS, "svg");
  overlay.classList.add(themeHook.pdfAnnotationOverlay);
  overlay.setAttribute("aria-hidden", "true");
  overlay.setAttribute(
    "viewBox",
    `0 0 ${unitPage.viewport.width} ${unitPage.viewport.height}`,
  );
  overlay.setAttribute("preserveAspectRatio", "none");

  for (const placement of annotations) {
    const { annotation } = placement;
    for (const mark of marksFor(unitPage, placement)) {
      mark.classList.add(themeHook.pdfAnnotationMark);
      mark.classList.toggle(
        SELECTED_CLASS,
        selected?.has(annotation.key) === true,
      );
      mark.dataset.zoteroAnnotationKey = annotation.key;
      mark.dataset.zoteroAnnotationType = annotation.type;
      overlay.append(mark);
    }
  }

  // Appended last, so nothing PDF.js paints later sits over the marks.
  if (overlay.childElementCount > 0) page.div.append(overlay);
}

/** One Annotation's hit area on one page, as the hit test measures it. */
export interface MarkTarget {
  /** The Annotation's Indexed Key. */
  key: string;
  /** Every box it covers on this page, in the page's own units. */
  rects: readonly PageRect[];
}

/**
 * The boxes this page's marks cover, in the same page units the overlay draws
 * them in — the hit test's whole input, converted once per click rather than
 * per mark.
 *
 * Ink and free text carry no per-page rectangles, so each answers with the box
 * it paints: an ink stroke's path bounds and a comment's own rectangle.
 */
export function markTargets(
  page: OverlayPageView,
  annotations: readonly PdfPageAnnotation[],
): MarkTarget[] {
  const unitPage = toPageUnits(page);
  return annotations.flatMap((placement) => {
    const rects = hitRectsOf(unitPage, placement);
    return rects.length === 0 ? [] : [{ key: placement.annotation.key, rects }];
  });
}

/**
 * The page box in PDF points, which is what the overlay's `viewBox` is built
 * from and therefore the units every mark rectangle is measured in.
 */
export function pageUnitSize(page: OverlayPageView): {
  width: number;
  height: number;
} {
  const { viewport } = toPageUnits(page);
  return { width: viewport.width, height: viewport.height };
}

function hitRectsOf(
  page: OverlayPage,
  { position, rects }: PdfPageAnnotation,
): PageRect[] {
  if (rects.length > 0) {
    return rects.map((rect) => pdfRectToPage(page.viewport, rect));
  }
  switch (position.kind) {
    case "pdf-ink":
      return inkBounds(page, position);
    case "pdf-text":
      return position.rects[0]
        ? [pdfRectToPage(page.viewport, position.rects[0])]
        : [];
    default:
      return [];
  }
}

function inkBounds(page: OverlayPage, position: PdfInkPosition): PageRect[] {
  const points = position.paths.flatMap((path) => {
    const converted: [number, number][] = [];
    for (let index = 0; index + 1 < path.length; index += 2) {
      const [x, y] = page.viewport.convertToViewportPoint(
        path[index]!,
        path[index + 1]!,
      );
      converted.push([x, y]);
    }
    return converted;
  });
  if (points.length === 0) return [];
  // Half the stroke width spills either side of the path, which is what makes a
  // one-pixel-thin stroke reachable at all.
  const spill = position.width / 2;
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return [
    [
      Math.min(...xs) - spill,
      Math.min(...ys) - spill,
      Math.max(...xs) + spill,
      Math.max(...ys) + spill,
    ],
  ];
}

interface PdfPagePlacement extends PdfPageAnnotation {
  pageIndex: number;
}

/**
 * The primitives one Annotation draws on one page. Ink and free text pair with
 * a position shape of their own, so a type carrying any other shape — a pairing
 * Zotero never writes — draws nothing.
 */
function marksFor(
  page: OverlayPage,
  { annotation, position, rects }: PdfPageAnnotation,
): SVGElement[] {
  switch (annotation.type) {
    case "highlight":
      return rects.map((rect) => renderHighlight(page, annotation, rect));
    case "underline":
      return rects.map((rect) => renderUnderline(page, annotation, rect));
    case "note":
      return rects[0] ? [renderNote(page, annotation, rects[0])] : [];
    case "image":
      return rects[0] ? [renderImage(page, annotation, rects[0])] : [];
    case "ink":
      return position.kind === "pdf-ink"
        ? [renderInk(page, annotation, position)]
        : [];
    case "text":
      return position.kind === "pdf-text" && position.rects.length > 0
        ? [renderText(page, annotation, position)]
        : [];
    default:
      return [];
  }
}

function renderHighlight(
  page: OverlayPage,
  annotation: AnnotationRecord,
  rect: PdfRect,
): SVGRectElement {
  const element = createRect(page, pdfRectToPage(page.viewport, rect));
  element.classList.add(themeHook.pdfAnnotationHighlight);
  element.setAttribute("fill", colorOf(annotation));
  return element;
}

/** A line along the bottom edge of each rectangle, as Zotero draws it unrotated. */
function renderUnderline(
  page: OverlayPage,
  annotation: AnnotationRecord,
  rect: PdfRect,
): SVGLineElement {
  const [left, , right, bottom] = pdfRectToPage(page.viewport, rect);
  const element = page.document.createElementNS(SVG_NS, "line");
  element.setAttribute("x1", String(left));
  element.setAttribute("y1", String(bottom));
  element.setAttribute("x2", String(right));
  element.setAttribute("y2", String(bottom));
  element.setAttribute("stroke", colorOf(annotation));
  element.setAttribute("stroke-width", "1");
  return element;
}

/** Zotero's sticky note: a rounded body with the corner folded back. */
function renderNote(
  page: OverlayPage,
  annotation: AnnotationRecord,
  rect: PdfRect,
): SVGGElement {
  const [left, top, right, bottom] = pdfRectToPage(page.viewport, rect);
  const width = right - left;
  const height = bottom - top;
  const group = page.document.createElementNS(SVG_NS, "g");
  const body = page.document.createElementNS(SVG_NS, "rect");
  body.setAttribute("x", String(left));
  body.setAttribute("y", String(top));
  body.setAttribute("width", String(width));
  body.setAttribute("height", String(height));
  body.setAttribute("rx", String(Math.min(width, height) / 8));
  body.setAttribute("fill", colorOf(annotation));
  const fold = page.document.createElementNS(SVG_NS, "path");
  fold.setAttribute(
    "d",
    `M ${right - width / 3} ${top} L ${right} ${top + height / 3} L ${right} ${top} Z`,
  );
  // The fold takes its paper colour from the stylesheet: an SVG presentation
  // attribute is not a CSS declaration, so `var()` never substitutes there and
  // the value would fall back to a black fill in either theme.
  fold.classList.add(themeHook.pdfAnnotationNoteFold);
  group.append(body, fold);
  return group;
}

function renderImage(
  page: OverlayPage,
  annotation: AnnotationRecord,
  rect: PdfRect,
): SVGRectElement {
  const element = createRect(page, pdfRectToPage(page.viewport, rect));
  element.setAttribute("fill", "none");
  element.setAttribute("stroke", colorOf(annotation));
  element.setAttribute("stroke-width", "3");
  return element;
}

/**
 * One path per stroke, at the width Zotero stored. The width is used raw: it is
 * already in PDF points, which is what the page-unit `viewBox` is measured in.
 */
function renderInk(
  page: OverlayPage,
  annotation: AnnotationRecord,
  position: PdfInkPosition,
): SVGPathElement {
  const element = page.document.createElementNS(SVG_NS, "path");
  const paths = position.paths.map((path) => {
    const points: string[] = [];
    for (let index = 0; index + 1 < path.length; index += 2) {
      const [x, y] = page.viewport.convertToViewportPoint(
        path[index]!,
        path[index + 1]!,
      );
      points.push(`${points.length === 0 ? "M" : "L"} ${x} ${y}`);
    }
    return points.join(" ");
  });
  element.setAttribute("d", paths.join(" "));
  element.setAttribute("fill", "none");
  element.setAttribute("stroke", colorOf(annotation));
  element.setAttribute("stroke-width", String(position.width));
  element.setAttribute("stroke-linecap", "round");
  element.setAttribute("stroke-linejoin", "round");
  return element;
}

/**
 * The comment typed onto the page, at the stored font size and rotation. Zotero
 * lays the same text out in a wrapping textarea; one run is the approximation
 * this milestone accepts.
 */
function renderText(
  page: OverlayPage,
  annotation: AnnotationRecord,
  position: PdfTextPosition,
): SVGTextElement {
  const element = page.document.createElementNS(SVG_NS, "text");
  const [left, top, right, bottom] = pdfRectToPage(
    page.viewport,
    position.rects[0]!,
  );
  element.setAttribute("x", String(left));
  element.setAttribute("y", String(top + position.fontSize));
  element.setAttribute("fill", colorOf(annotation));
  element.setAttribute("font-size", String(position.fontSize));
  const rotation = page.viewport.rotation - position.rotation;
  if (rotation !== 0) {
    element.setAttribute(
      "transform",
      `rotate(${rotation} ${(left + right) / 2} ${(top + bottom) / 2})`,
    );
  }
  element.textContent = annotation.comment ?? annotation.text ?? "";
  return element;
}

function createRect(
  page: OverlayPage,
  [left, top, right, bottom]: PageRect,
): SVGRectElement {
  const element = page.document.createElementNS(SVG_NS, "rect");
  element.setAttribute("x", String(left));
  element.setAttribute("y", String(top));
  element.setAttribute("width", String(right - left));
  element.setAttribute("height", String(bottom - top));
  return element;
}

/** The mark takes the page's own colour when Zotero stored none. */
function colorOf(annotation: AnnotationRecord): string {
  return annotation.color ?? "currentColor";
}

/** A box in one page's own units, `[left, top, right, bottom]`. */
export type PageRect = readonly [number, number, number, number];

/** The page reduced to what a mark is drawn from: page units and a document. */
interface OverlayPage {
  document: Document;
  viewport: Pick<
    PDFPageViewport,
    "width" | "height" | "rotation" | "convertToViewportPoint"
  >;
}

/**
 * The viewport rebuilt at scale 1, which measures the page in PDF points and is
 * therefore the same at every zoom step.
 *
 * `clone()` re-runs the PDF.js transform from the page box and keeps the numbers
 * exact. Dividing the built viewport by `scale * userUnit` reaches the same
 * units but leaves float noise, so it is the fallback for a build with no
 * `clone`, not the first choice.
 */
function toPageUnits(page: OverlayPageView): OverlayPage {
  const document_ = page.div.ownerDocument;
  const { viewport } = page;
  const base = viewport.clone?.({ scale: 1 });
  if (base) return { document: document_, viewport: base };

  const total = viewport.scale * viewport.userUnit;
  return {
    document: document_,
    viewport: {
      width: viewport.width / total,
      height: viewport.height / total,
      rotation: viewport.rotation,
      convertToViewportPoint(x, y) {
        const [pointX, pointY] = viewport.convertToViewportPoint(x, y);
        return [pointX / total, pointY / total];
      },
    },
  };
}

/**
 * Both diagonal corners are converted and the result re-normalised, because a
 * rotated page swaps which corner is the top left — that is what lets one code
 * path serve all four rotations.
 */
function pdfRectToPage(
  viewport: OverlayPage["viewport"],
  rect: PdfRect,
): PageRect {
  const [x1, y2] = viewport.convertToViewportPoint(rect[0], rect[1]);
  const [x2, y1] = viewport.convertToViewportPoint(rect[2], rect[3]);
  return [
    Math.min(x1, x2),
    Math.min(y1, y2),
    Math.max(x1, x2),
    Math.max(y1, y2),
  ];
}
