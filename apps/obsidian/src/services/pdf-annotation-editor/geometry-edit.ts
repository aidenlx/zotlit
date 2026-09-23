// The arithmetic of a Geometry Edit: where a selected mark's Mark Handles sit,
// which grip a press takes, and the position a drag proposes. Ported from
// Zotero's reader so a mark adjusted in either application lands the same.
//
// @see https://github.com/aidenlx/zotlit/issues/1200
import type { PdfRectsPosition } from "@zotlit/db";

import type { AnnotationRecord } from "@/services/annotation-repository/service";
import { writePosition } from "@/services/annotation-repository/write";

import type { Point } from "./hit-test";

/**
 * A Mark Handle, by the edges of the position's bounding rect it moves, named
 * in PDF space: `t` is the rect's `y2`, since PDF counts up from the page foot.
 */
export type Handle = "tl" | "t" | "tr" | "r" | "br" | "b" | "bl" | "l";

/** What a press holds: one Mark Handle, or the body of the selected mark. */
export type Grip = Handle | "body";

/** A point in PDF page space, `[x, y]` in points. */
export type PdfPoint = readonly [number, number];

/** A position a Geometry Edit can propose. */
export type EditablePosition = PdfRectsPosition;

/**
 * The smallest side an image rect may be resized to, in PDF points.
 *
 * @see ~/repo/zotlit-repo/zotero/reader/src/common/defines.js — `MIN_IMAGE_ANNOTATION_SIZE`
 */
export const MIN_IMAGE_ANNOTATION_SIZE = 10;

/**
 * Half a Mark Handle's side, in CSS pixels. Zotero's reader measures `5 *
 * devicePixelRatio` canvas pixels, which is five CSS pixels.
 */
export const HANDLE_RADIUS = 5;

/**
 * The order Zotero's reader tries the handles in: corners first, so a corner
 * wins a point an edge midpoint also covers.
 *
 * @see ~/repo/zotlit-repo/zotero/reader/src/pdf/pdf-view.js — `getSelectedAnnotationAction`
 */
const PRIORITY: readonly Handle[] = [
  "tr",
  "tl",
  "br",
  "bl",
  "l",
  "r",
  "t",
  "b",
];

/**
 * The Mark Handles a selected mark shows, at PDF points. An image shows four
 * corners and four edge midpoints; a mark this build cannot yet adjust shows
 * none.
 */
export function handleLayout({
  type,
  position,
}: Pick<AnnotationRecord, "type" | "position">): {
  grip: Handle;
  at: PdfPoint;
}[] {
  if (type !== "image" || position.kind !== "pdf-rects") return [];
  const rect = position.rects[0];
  if (!rect) return [];
  const [x1, y1, x2, y2] = rect;
  const xm = (x1 + x2) / 2;
  const ym = (y1 + y2) / 2;
  return [
    { grip: "tl", at: [x1, y2] },
    { grip: "t", at: [xm, y2] },
    { grip: "tr", at: [x2, y2] },
    { grip: "r", at: [x2, ym] },
    { grip: "br", at: [x2, y1] },
    { grip: "b", at: [xm, y1] },
    { grip: "bl", at: [x1, y1] },
    { grip: "l", at: [x1, ym] },
  ];
}

/**
 * Whether a press on the selected mark's body moves it. An image moves by its
 * body; the body of a highlight or underline is the text selection's.
 */
export function movesByBody(type: AnnotationRecord["type"]): boolean {
  return type === "image";
}

/**
 * The grip a press takes, measured in whichever space the handles, the body,
 * and the point share.
 *
 * @param options.handles each handle's centre.
 * @param options.body the box a body press takes, or `null` for a mark that
 *   does not move by its body.
 * @param options.radius half a handle's side.
 * @returns `null` for a press on neither a handle nor the body.
 */
export function gripAt({
  handles,
  body,
  point,
  radius,
}: {
  handles: readonly { grip: Handle; at: Point }[];
  body: readonly [number, number, number, number] | null;
  point: Point;
  radius: number;
}): Grip | null {
  for (const grip of PRIORITY) {
    const handle = handles.find((candidate) => candidate.grip === grip);
    if (
      handle &&
      Math.abs(point.x - handle.at.x) <= radius &&
      Math.abs(point.y - handle.at.y) <= radius
    )
      return grip;
  }
  if (!body) return null;
  const [left, top, right, bottom] = body;
  const inside =
    point.x >= left && point.x <= right && point.y >= top && point.y <= bottom;
  return inside ? "body" : null;
}

/**
 * The position a drag proposes: the confirmed position with the held edges, or
 * for the body the whole rect, carried by the pointer's travel since the press.
 * An edge stops ten points short of the opposite one and at the page's view
 * box; a moved rect stops flush with the view box.
 *
 * @param options.from where the press fell, in PDF points on the mark's page.
 * @param options.to where the pointer is now, on the same page.
 * @param options.viewBox the page's `[x1, y1, x2, y2]` in PDF points.
 * @see ~/repo/zotlit-repo/zotero/reader/src/pdf/pdf-view.js — `_handlePointerMove`, the `resize` branch for `image`
 */
export function proposePosition({
  confirmed,
  grip,
  from,
  to,
  viewBox,
}: {
  confirmed: EditablePosition;
  grip: Grip;
  from: PdfPoint;
  to: PdfPoint;
  viewBox: readonly number[];
}): EditablePosition {
  const rect = confirmed.rects[0];
  if (!rect) return confirmed;
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const [left = 0, bottom = 0, right = 0, top = 0] = viewBox;
  const [x1, y1, x2, y2] = rect;
  if (grip === "body") {
    const mx = clamp(dx, left - x1, right - x2);
    const my = clamp(dy, bottom - y1, top - y2);
    return { ...confirmed, rects: [[x1 + mx, y1 + my, x2 + mx, y2 + my]] };
  }
  const next: [number, number, number, number] = [x1, y1, x2, y2];
  const min = MIN_IMAGE_ANNOTATION_SIZE;
  if (grip.includes("l")) next[0] = Math.max(Math.min(x1 + dx, x2 - min), left);
  else if (grip.includes("r"))
    next[2] = Math.min(Math.max(x2 + dx, x1 + min), right);
  if (grip.includes("b"))
    next[1] = Math.max(Math.min(y1 + dy, y2 - min), bottom);
  else if (grip.includes("t"))
    next[3] = Math.min(Math.max(y2 + dy, y1 + min), top);
  return { ...confirmed, rects: [next] };
}

/**
 * Whether two positions store the same: Zotero keeps three decimals, so a
 * drag that moved less than that writes nothing.
 */
export function sameGeometry(
  a: EditablePosition,
  b: EditablePosition,
): boolean {
  return writePosition(a) === writePosition(b);
}

/**
 * The cursor a grip shows. The handle is named in PDF space, and a quarter
 * turn of the page lays its horizontal edges upright, so the cursor follows
 * the page's rotation.
 *
 * @param rotation the page viewport's rotation, in degrees.
 */
export function gripCursor(grip: Grip, rotation: number): string {
  if (grip === "body") return "move";
  const turned = rotation % 180 !== 0;
  if (grip.length === 1) {
    const horizontal = grip === "l" || grip === "r";
    return horizontal !== turned ? "ew-resize" : "ns-resize";
  }
  const falling = grip === "tl" || grip === "br";
  return falling !== turned ? "nwse-resize" : "nesw-resize";
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}
