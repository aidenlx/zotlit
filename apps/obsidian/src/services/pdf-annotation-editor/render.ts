// Draws Zotero Annotations as one SVG overlay over an Obsidian PDF page.
import type { PDFPageView, PDFPageViewport } from "obsidian";

import type {
  PdfInkPosition,
  PdfRectsPosition,
  PdfTextPosition,
} from "@zotlit/db";

import { themeHook } from "@/lib/theme-hooks";
import type { AnnotationRecord } from "@/services/annotation-repository/service";

import { freeTextLayout } from "./free-text-layout";
import type { PagePoint, PageRect, Turn } from "./free-text-layout";
import { unionOutlinePath } from "./rect-union-outline";
import "./style.css";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Obsidian's own state class, which ADR 0042 keeps as the mark's one mutable bit. */
const SELECTED_CLASS = "is-selected";

/**
 * The gap the selected outline hugs the mark's own rects by, in page units —
 * a hairline's worth of daylight rather than Zotero's own 10pt bounding-box
 * frame, since this outline follows the run's actual shape.
 */
const SELECTION_OUTLINE_PADDING = 1.5;

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
    // The PDF-point to viewport-pixel matrix, which selection capture inverts.
    | "transform"
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

  // Appended last, above every mark, so the ring round a selected run's own
  // silhouette never sits under a neighbour's mark.
  for (const placement of annotations) {
    if (selected?.has(placement.annotation.key) !== true) continue;
    const outline = renderSelectionOutline(unitPage, placement);
    if (!outline) continue;
    // A pen stroke's casing is the one outline that goes under its own mark,
    // since the pen is what draws over it to leave a band either side.
    if (isInk(placement)) overlay.prepend(outline);
    else overlay.append(outline);
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

/**
 * The ring round a selected Annotation's own merged silhouette: one hairline
 * outline that hugs the actual staircase shape of its rects, rather than a
 * glow on every one of them or a box round their bounds.
 *
 * A highlight's outline follows its own text lines, from the same rects the
 * hit test measures; an ink stroke carries no rects, so its outline is traced
 * from a chain of boxes sampled along the stroke and hugs the squiggle.
 * `vector-effect="non-scaling-stroke"` keeps the ring a true hairline at
 * every zoom step, since the overlay's `viewBox` maps page units onto the
 * browser's own page box with `preserveAspectRatio="none"`.
 */
function renderSelectionOutline(
  page: OverlayPage,
  placement: PdfPageAnnotation,
): SVGPathElement | undefined {
  if (isInk(placement)) return renderInkCasing(page, placement.position);

  // A free-text ring is the stored rectangle under its own turn, so the ring
  // and the run stay together on a turned page; every other mark rings the
  // rects the hit test already measures.
  const { position } = placement;
  const ring =
    position.kind === "pdf-text" ? layoutOf(page, position).ring : undefined;

  const d = ring
    ? unionOutlinePath([ring.rect], 0)
    : unionOutlinePath(hitRectsOf(page, placement), SELECTION_OUTLINE_PADDING);
  if (d.length === 0) return undefined;

  const element = page.document.createElementNS(SVG_NS, "path");
  element.setAttribute("d", d);
  const turn = ring && transformOf(ring.turns);
  if (turn !== undefined && turn !== "") {
    element.setAttribute("transform", turn);
  }
  element.setAttribute("fill", "none");
  element.setAttribute("stroke-linejoin", "round");
  element.setAttribute("vector-effect", "non-scaling-stroke");
  // The stroke colour comes from the stylesheet: an SVG presentation
  // attribute never substitutes `var()`, so a `stroke` attribute here would
  // render black in either theme.
  element.classList.add(themeHook.pdfAnnotationSelectionOutline);
  return element;
}

/**
 * A selected pen stroke's own casing: the path the stroke already draws,
 * painted underneath it at the padding either side, so the accent reads as a
 * band following the squiggle.
 *
 * The browser carries the caps and joins, which is why this outline is the
 * stroke's own `d` rather than a traced one: a hand-drawn curve stays a curve
 * and a sharp turn stays sharp, at every zoom step and on any shape.
 */
function renderInkCasing(
  page: OverlayPage,
  position: PdfInkPosition,
): SVGPathElement {
  const element = page.document.createElementNS(SVG_NS, "path");
  element.setAttribute("d", inkPathOf(page, position));
  element.setAttribute("fill", "none");
  element.setAttribute("stroke-linecap", "round");
  element.setAttribute("stroke-linejoin", "round");
  // The width is the pen's own plus the padding, so it rides the page units
  // the pen is measured in; the stylesheet's hairline default is for the
  // traced rings, and an inline width is what overrides a `:where()` rule.
  element.style.strokeWidth = String(
    position.width + 2 * SELECTION_OUTLINE_PADDING,
  );
  element.classList.add(themeHook.pdfAnnotationSelectionOutline);
  return element;
}

/** Whether the placement is a pen stroke, which carries its own path in place
 * of the rectangles every other mark is measured by. */
function isInk(
  placement: PdfPageAnnotation,
): placement is PdfPageAnnotation & { position: PdfInkPosition } {
  return placement.rects.length === 0 && placement.position.kind === "pdf-ink";
}

/** One stored stroke's flat `[x, y, x, y, …]` run, in the page's own units. */
function pagePoints(page: OverlayPage, path: readonly number[]): PagePoint[] {
  const points: PagePoint[] = [];
  for (let index = 0; index + 1 < path.length; index += 2) {
    const [x, y] = page.viewport.convertToViewportPoint(
      path[index]!,
      path[index + 1]!,
    );
    points.push([x, y]);
  }
  return points;
}

/** The free-text geometry, bound to this page's own PDF-point mapping. */
function layoutOf(page: OverlayPage, position: PdfTextPosition) {
  return freeTextLayout(
    (x, y) => page.viewport.convertToViewportPoint(x, y),
    position,
    SELECTION_OUTLINE_PADDING,
  );
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
      return position.rects[0] ? [layoutOf(page, position).hit] : [];
    default:
      return [];
  }
}

function inkBounds(page: OverlayPage, position: PdfInkPosition): PageRect[] {
  const points = position.paths.flatMap((path) => pagePoints(page, path));
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

/**
 * A note glyph in lucide's idiom, over Obsidian's own icon set: the body path
 * stroked and lightly filled in the Annotation's own colour, its bottom-right
 * corner cut on the diagonal, and that fold's crease traced as a second,
 * unfilled stroke.
 *
 * Both paths are authored on lucide's 24-unit grid, with its round joins and
 * caps, and mapped onto the stored rect the way the rounded rect this
 * replaces already was: a translate to the rect's own origin, then a scale to
 * its own width and
 * height. `vector-effect="non-scaling-stroke"` on each keeps the stroke a
 * true hairline width at every zoom step, for the same reason the selection
 * outline needs it: the overlay's `viewBox` maps page units onto the
 * browser's own page box with `preserveAspectRatio="none"`.
 *
 * @see https://lucide.dev/icons/sticky-note — the icon whose idiom this
 *   follows. The fold is cut at the bottom right, so the glyph reads as a
 *   note peeling off the page rather than as a document.
 */
function renderNote(
  page: OverlayPage,
  annotation: AnnotationRecord,
  rect: PdfRect,
): SVGGElement {
  const [left, top, right, bottom] = pdfRectToPage(page.viewport, rect);
  const width = right - left;
  const height = bottom - top;
  const group = page.document.createElementNS(SVG_NS, "g");
  group.setAttribute(
    "transform",
    `translate(${left} ${top}) scale(${width / 24} ${height / 24})`,
  );
  group.setAttribute("fill", "none");
  group.setAttribute("stroke", colorOf(annotation));
  group.setAttribute("stroke-linecap", "round");
  group.setAttribute("stroke-linejoin", "round");
  group.classList.add(themeHook.pdfAnnotationNoteIcon);

  const body = page.document.createElementNS(SVG_NS, "path");
  body.setAttribute(
    "d",
    "M 6 3.5 H 18 A 2.5 2.5 0 0 1 20.5 6 V 13.5 L 13.5 20.5 H 6 A 2.5 2.5 0 0 1 3.5 18 V 6 A 2.5 2.5 0 0 1 6 3.5 Z",
  );
  body.setAttribute("fill", colorOf(annotation));
  body.setAttribute("vector-effect", "non-scaling-stroke");
  // The fill's alpha comes from the stylesheet, so a theme can tune how
  // strongly the icon reads against the page underneath it.
  body.classList.add(themeHook.pdfAnnotationNoteFill);

  // Two open segments, so the corner reads as a crease under the stroke the
  // group carries. A closed shape here would need a fill of its own.
  const crease = page.document.createElementNS(SVG_NS, "path");
  crease.setAttribute("d", "M 13.5 13.5 H 20.5 M 13.5 13.5 V 20.5");
  crease.setAttribute("vector-effect", "non-scaling-stroke");
  crease.classList.add(themeHook.pdfAnnotationNoteCrease);

  group.append(body, crease);
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
  element.setAttribute("d", inkPathOf(page, position));
  element.setAttribute("fill", "none");
  element.setAttribute("stroke", colorOf(annotation));
  element.setAttribute("stroke-width", String(position.width));
  element.setAttribute("stroke-linecap", "round");
  element.setAttribute("stroke-linejoin", "round");
  return element;
}

/** Every stroke of one ink mark as one `d`, which both the pen and the casing
 * under it are drawn from. */
function inkPathOf(page: OverlayPage, position: PdfInkPosition): string {
  return position.paths
    .map((path) =>
      pagePoints(page, path)
        .map(([x, y], index) => `${index === 0 ? "M" : "L"} ${x} ${y}`)
        .join(" "),
    )
    .join(" ");
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
  const { baseline, turns } = layoutOf(page, position);
  element.setAttribute("x", String(baseline[0]));
  element.setAttribute("y", String(baseline[1]));
  element.setAttribute("fill", colorOf(annotation));
  element.setAttribute("font-size", String(position.fontSize));
  const turn = transformOf(turns);
  if (turn !== undefined) element.setAttribute("transform", turn);
  element.textContent = annotation.comment ?? annotation.text ?? "";
  return element;
}

/** A turn list as SVG writes it, applied from the last one to the first. */
function transformOf(turns: readonly Turn[]): string | undefined {
  if (turns.length === 0) return undefined;
  return turns
    .map(({ angle, pivot: [x, y] }) => `rotate(${angle} ${x} ${y})`)
    .join(" ");
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

export type { PageRect } from "./free-text-layout";

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
