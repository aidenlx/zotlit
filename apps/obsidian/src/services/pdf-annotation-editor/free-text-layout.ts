// Where a free-text Annotation's run, its ring and its hit box sit on a page.
import type { PdfTextPosition } from "@zotlit/db";

/** A point in one page's own units, `[x, y]`. */
export type PagePoint = readonly [number, number];

/** A box in one page's own units, `[left, top, right, bottom]`. */
export type PageRect = readonly [number, number, number, number];

/** One PDF point mapped into the page's own units, as the viewport maps it. */
export type ToPagePoint = (x: number, y: number) => PagePoint;

/** A turn about a point, in degrees clockwise in the page's own frame. */
export interface Turn {
  angle: number;
  pivot: PagePoint;
}

/**
 * Everything a free-text Annotation is drawn and measured from, in page units.
 *
 * `turns` are ordered the way an SVG transform list applies them — the last
 * one first. The ring is the stored rectangle under the stored turn alone,
 * because the page's own turn already reached that rectangle; `hit` is the
 * axis-aligned box that turned rectangle sweeps out, which is what a pointer
 * is measured against.
 */
export interface FreeTextLayout {
  /** Where the run's baseline starts. */
  baseline: PagePoint;
  /** What the run is turned by. */
  turns: readonly Turn[];
  /** The rectangle the ring is traced round, and what it is turned by. */
  ring: { rect: PageRect; turns: readonly Turn[] };
  /** The box the pointer is measured against. */
  hit: PageRect;
}

/**
 * Zotero lays a free-text run out inside the rectangle it stored, then turns
 * the rectangle and the run together about that rectangle's own centre. The
 * page's own turn reaches both through the viewport, so it belongs to where
 * the baseline lands and to which way the run reads — never to a second turn
 * laid on the rectangle afterwards.
 *
 * @see https://github.com/zotero/reader/blob/master/src/pdf/page.js
 *   `_pushSelectedOutlines` — the page transform composed with
 *   `getRotationTransform` about the stored rectangle's own centre.
 * @see https://github.com/zotero/reader/blob/master/src/pdf/lib/text-annotation.js
 *   `getBoundingRect` — the four corners of that turned rectangle, re-bounded.
 *
 * @param toPagePoint the viewport's own PDF-point to page-unit mapping.
 * @param padding how far outside the stored rectangle the ring is traced.
 */
export function freeTextLayout(
  toPagePoint: ToPagePoint,
  position: PdfTextPosition,
  padding: number,
): FreeTextLayout {
  const stored = position.rects[0]!;
  const left = Math.min(stored[0], stored[2]);
  const top = Math.max(stored[1], stored[3]);

  const rect = toPageRect(toPagePoint, stored);
  const centre = centreOf(rect);
  const storedTurn: Turn[] =
    position.rotation === 0
      ? []
      : // PDF measures its y upwards and the page measures it downwards, so
        // the stored angle reads the other way round here.
        [{ angle: -position.rotation, pivot: centre }];

  const baseline = toPagePoint(left, top - position.fontSize);
  const reading = readingAngle(toPagePoint, left, top);

  return {
    baseline,
    turns:
      reading === 0
        ? storedTurn
        : [...storedTurn, { angle: reading, pivot: baseline }],
    ring: { rect: grow(rect, padding), turns: storedTurn },
    hit: turnedBounds(rect, storedTurn[0]?.angle ?? 0),
  };
}

/** Where the page's own turn points the reading direction, in degrees. */
function readingAngle(
  toPagePoint: ToPagePoint,
  left: number,
  top: number,
): number {
  const [ox, oy] = toPagePoint(left, top);
  const [ux, uy] = toPagePoint(left + 1, top);
  return Math.round((Math.atan2(uy - oy, ux - ox) * 180) / Math.PI);
}

/** The axis-aligned box a turned rectangle sweeps out, about its own centre. */
function turnedBounds(rect: PageRect, angle: number): PageRect {
  if (angle === 0) return rect;
  const radians = (angle * Math.PI) / 180;
  const [cos, sin] = [Math.cos(radians), Math.sin(radians)];
  const [cx, cy] = centreOf(rect);
  const turned = cornersOf(rect).map(
    ([x, y]): PagePoint => [
      cx + (x - cx) * cos - (y - cy) * sin,
      cy + (x - cx) * sin + (y - cy) * cos,
    ],
  );
  const xs = turned.map(([x]) => x);
  const ys = turned.map(([, y]) => y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** The stored rectangle in page units, however Zotero ordered its corners. */
function toPageRect(
  toPagePoint: ToPagePoint,
  [x1, y1, x2, y2]: readonly number[],
): PageRect {
  const [ax, ay] = toPagePoint(x1!, y1!);
  const [bx, by] = toPagePoint(x2!, y2!);
  return [
    Math.min(ax, bx),
    Math.min(ay, by),
    Math.max(ax, bx),
    Math.max(ay, by),
  ];
}

function cornersOf([left, top, right, bottom]: PageRect): PagePoint[] {
  return [
    [left, top],
    [right, top],
    [right, bottom],
    [left, bottom],
  ];
}

function centreOf([left, top, right, bottom]: PageRect): PagePoint {
  return [(left + right) / 2, (top + bottom) / 2];
}

function grow([left, top, right, bottom]: PageRect, by: number): PageRect {
  return [left - by, top - by, right + by, bottom + by];
}
