// Which Annotation Mark a gesture on a PDF page takes, decided from geometry
// alone: the marks take no pointer input, so nothing but these numbers can say
// what was clicked.
//
// @see apps/obsidian/docs/adr/0042-the-surfaces-inside-the-pdf-reader-are-vanilla-dom-on-obsidians-popover.md
import { nearStroke } from "./ink-path";
import type { MarkTarget, PageRect } from "./render";

/**
 * How far a pointer may travel between press and release and still count as a
 * click rather than a drag, in CSS pixels.
 */
export const CLICK_SLOP = 4;

/** The forgiveness around a mark's rectangles, in CSS pixels. */
export const HIT_PAD = 2;

export interface Point {
  x: number;
  y: number;
}

/**
 * One page as the browser laid it out, beside the same page measured in its own
 * units — the PDF points every mark rectangle is in.
 */
export interface PageBox {
  /** The page element's client rectangle. */
  left: number;
  top: number;
  width: number;
  height: number;
  /** The page box in PDF points, which the overlay's `viewBox` maps onto it. */
  unitWidth: number;
  unitHeight: number;
}

/** A point in one page's own units, with the pixel forgiveness converted too. */
export interface PagePoint {
  point: Point;
  pad: number;
}

/** The page a click landed on, its marks, and where the click fell on it. */
export interface HitPage {
  index: number;
  targets: readonly MarkTarget[];
  at: PagePoint;
}

/** The mark a click selected, and the page point it was taken at. */
export interface MarkSelectionPoint {
  key: string;
  pageIndex: number;
  point: Point;
}

export interface MarkClickInput {
  /** The page under the pointer, or `null` when no page with marks is. */
  page: HitPage | null;
  /** How far the pointer travelled between press and release, in CSS pixels. */
  travel: number;
  /** Whether the window selection is collapsed. */
  collapsed: boolean;
  /** Whether the PDF's own link annotation sits under the point. */
  onLink: boolean;
  altKey: boolean;
  /** What is selected now, and where the click that selected it fell. */
  previous: MarkSelectionPoint | null;
}

export type MarkClick =
  | { kind: "ignore" }
  | { kind: "deselect" }
  /** @param stack every mark under the point, smallest first, which the stepper walks. */
  | { kind: "select"; key: string; stack: readonly string[] };

/**
 * What a completed pointer gesture over a PDF page does to the selection.
 *
 * A gesture is a mark click only when it barely moved and left the window
 * selection collapsed — anything else is a text selection, which the browser
 * owns. The PDF's own link annotation wins a plain click, because "follow the
 * reference" is the reader's contract; `Alt` reaches the mark beneath it, and
 * so does the stack stepper once a neighbouring mark is selected.
 *
 * A click that reaches no mark is the click-away, so it deselects; a repeat
 * click at the same point steps through the stack under it and wraps.
 *
 * @see https://github.com/aidenlx/zotlit/issues/1148
 */
export function resolveMarkClick({
  page,
  travel,
  collapsed,
  onLink,
  altKey,
  previous,
}: MarkClickInput): MarkClick {
  if (travel >= CLICK_SLOP || !collapsed) return { kind: "ignore" };
  if (onLink && !altKey) return { kind: "ignore" };
  if (!page) return { kind: "deselect" };

  const hits = marksAtPoint(page.targets, page.at);
  if (hits.length === 0) return { kind: "deselect" };

  const repeat =
    previous !== null &&
    previous.pageIndex === page.index &&
    within(previous.point, page.at);
  const from = repeat ? hits.indexOf(previous.key) : -1;
  return { kind: "select", key: hits[(from + 1) % hits.length]!, stack: hits };
}

/**
 * The marks under a point, smallest area first, so the mark inside another is
 * the one a first click takes. An ink mark is under the point only near one of
 * its strokes, so the empty middle of a circled term takes no click.
 *
 * @returns the Indexed Keys of the marks hit, closest-fitting first.
 */
export function marksAtPoint(
  targets: readonly MarkTarget[],
  { point, pad }: PagePoint,
): string[] {
  return targets
    .flatMap((target) =>
      hitsTarget(target, point, pad)
        ? [{ key: target.key, area: areaOf(target.rects) }]
        : [],
    )
    .sort((a, b) => a.area - b.area)
    .map(({ key }) => key);
}

/**
 * Where a client point falls in one page's own units, and what the pixel
 * forgiveness is worth there, or `null` for a point outside the page box.
 *
 * The overlay's `viewBox` maps the page's unit box onto the laid-out page with
 * `preserveAspectRatio="none"`, so each axis scales on its own and this is its
 * exact inverse — at any zoom, and under any page rotation.
 */
export function pagePointOf(box: PageBox, client: Point): PagePoint | null {
  if (box.width <= 0 || box.height <= 0) return null;
  const scaleX = box.unitWidth / box.width;
  const scaleY = box.unitHeight / box.height;
  const point = {
    x: (client.x - box.left) * scaleX,
    y: (client.y - box.top) * scaleY,
  };
  const pad = HIT_PAD * Math.max(scaleX, scaleY);
  const outside =
    point.x < -pad ||
    point.y < -pad ||
    point.x > box.unitWidth + pad ||
    point.y > box.unitHeight + pad;
  return outside ? null : { point, pad };
}

/**
 * Where the Mark Popup hangs: the bottom centre of the union of a mark's
 * rectangles, in client coordinates, which Obsidian places below and falls back
 * above. `null` for a mark that draws no rectangle on this page.
 */
export function markAnchor(
  rects: readonly PageRect[],
  box: PageBox,
): Point | null {
  if (rects.length === 0 || box.width <= 0 || box.height <= 0) return null;
  const left = Math.min(...rects.map((rect) => rect[0]));
  const right = Math.max(...rects.map((rect) => rect[2]));
  const bottom = Math.max(...rects.map((rect) => rect[3]));
  return {
    x: box.left + (((left + right) / 2) * box.width) / box.unitWidth,
    y: box.top + (bottom * box.height) / box.unitHeight,
  };
}

/** How far apart two points are, in whichever units both are measured in. */
export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function within(point: Point, { point: at, pad }: PagePoint): boolean {
  return distance(point, at) <= pad;
}

/**
 * Whether a point takes a mark: inside a rectangle, with the pixel pad, or for
 * ink, near one of its strokes by Zotero's own rule, with the box grown by the
 * reach as the cheap first check.
 */
function hitsTarget(
  { rects, ink }: MarkTarget,
  point: Point,
  pad: number,
): boolean {
  if (!ink) return rects.some((rect) => covers(rect, point, pad));
  return (
    rects.some((rect) => covers(rect, point, ink.reach)) &&
    nearStroke([point.x, point.y], ink.paths, ink.reach)
  );
}

function covers(
  [left, top, right, bottom]: PageRect,
  point: Point,
  pad: number,
): boolean {
  return (
    point.x >= left - pad &&
    point.x <= right + pad &&
    point.y >= top - pad &&
    point.y <= bottom + pad
  );
}

/** A mark's area is every rectangle it draws, so a two-line quote outranks a word. */
function areaOf(rects: readonly PageRect[]): number {
  return rects.reduce(
    (total, [left, top, right, bottom]) =>
      total + (right - left) * (bottom - top),
    0,
  );
}
