// The arithmetic of a Geometry Edit: where a selected mark's Mark Handles sit,
// which grip a press takes, and the position a drag proposes. Ported from
// Zotero's reader so a mark adjusted in either application lands the same.
//
// @see https://github.com/aidenlx/zotlit/issues/1200
import type {
  AnnotationPosition,
  PdfInkPosition,
  PdfRectsPosition,
} from "@zotlit/db";

import type { AnnotationRecord } from "@/services/annotation-repository/service";
import { writePosition } from "@/services/annotation-repository/write";

import type { Point } from "./hit-test";

/**
 * A Mark Handle, by the edges of the position's bounding rect it moves, named
 * in PDF space: `t` is the rect's `y2`, since PDF counts up from the page foot.
 */
export type Handle = "tl" | "t" | "tr" | "r" | "br" | "b" | "bl" | "l";

/**
 * A highlight's or underline's Mark Handle, by the end of its range it moves;
 * the other end is the anchor.
 */
export type RangeGrip = "start" | "end";

/**
 * What a press holds: one Mark Handle of an image or ink, the body of the
 * selected mark, or one end of a text range.
 */
export type Grip = Handle | "body" | RangeGrip;

/** Whether a grip moves one end of a text range. */
export function isRangeGrip(grip: Grip): grip is RangeGrip {
  return grip === "start" || grip === "end";
}

/** A point in PDF page space, `[x, y]` in points. */
export type PdfPoint = readonly [number, number];

/** A position a Geometry Edit can propose. */
export type EditablePosition = PdfRectsPosition | PdfInkPosition;

/** A rect in PDF points, `[x1, y1, x2, y2]`. */
type PdfRect = [number, number, number, number];

/** Whether a Geometry Edit can propose a position of this shape. */
export function isEditablePosition(
  position: AnnotationPosition,
): position is EditablePosition {
  return position.kind === "pdf-rects" || position.kind === "pdf-ink";
}

/**
 * Half the width of a text range's handle strip, in CSS pixels, as Zotero's
 * reader pads the edge it lays the strip along.
 *
 * @see ~/repo/zotlit-repo/zotero/reader/src/pdf/pdf-view.js — `getSelectedAnnotationAction`, `padding = 3`
 */
export const RANGE_HANDLE_PADDING = 3;

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
 * How far ink's corner handles, and the box its body takes, stand out from its
 * strokes on each side, in PDF points. Zotero's reader grows the box by
 * `BOX_PADDING`, ten pixels across, so five on each side.
 *
 * @see ~/repo/zotlit-repo/zotero/reader/src/pdf/pdf-view.js — `getSelectedAnnotationAction`, `BOX_PADDING`
 */
export const INK_BOX_PADDING = 5;

/**
 * The smallest side an ink scale may leave, in PDF points.
 *
 * @see ~/repo/zotlit-repo/zotero/reader/src/pdf/pdf-view.js — `_handlePointerMove`, the `resize` branch for `ink`
 */
export const MIN_INK_SIZE = 1;

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
 * corners and four edge midpoints. Ink shows four corners on its stroke box,
 * padded out, and none while the box lacks a width or a height, which no
 * proportional scale can keep. A mark this build cannot yet adjust shows none.
 */
export function handleLayout({
  type,
  position,
}: Pick<AnnotationRecord, "type" | "position">): {
  grip: Handle;
  at: PdfPoint;
}[] {
  if (type === "ink" && position.kind === "pdf-ink") {
    const box = inkBox(position);
    if (!box || box[0] === box[2] || box[1] === box[3]) return [];
    const [x1, y1, x2, y2] = pad(box);
    return [
      { grip: "tl", at: [x1, y2] },
      { grip: "tr", at: [x2, y2] },
      { grip: "br", at: [x2, y1] },
      { grip: "bl", at: [x1, y1] },
    ];
  }
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
 * A highlight's or underline's two Mark Handles: a strip along the leading
 * edge of its first rect, and one along the trailing edge of its last, on the
 * next page where the range spilled onto it. The body carries none, since a
 * press there is the text selection's.
 *
 * Zotero's reader turns each strip by the text rotation of the characters
 * under its rect. The Structured Characters are read asynchronously, and a
 * handle is drawn and hit synchronously, so these lie as for upright text:
 * on the rect's left and right edges.
 *
 * @param padding half the strip's width, in PDF points.
 * @see ~/repo/zotlit-repo/zotero/reader/src/pdf/pdf-view.js — `getSelectedAnnotationAction`, the `highlight` and `underline` branch
 */
export function rangeHandles(
  { type, position }: Pick<AnnotationRecord, "type" | "position">,
  padding: number,
): { grip: RangeGrip; pageIndex: number; rect: PdfRect }[] {
  if (type !== "highlight" && type !== "underline") return [];
  if (position.kind !== "pdf-rects") return [];
  const first = position.rects[0];
  const spilled = position.nextPageRects?.length
    ? position.nextPageRects
    : undefined;
  const last = (spilled ?? position.rects).at(-1);
  if (!first || !last) return [];
  const strip = (x: number, [, y1, , y2]: readonly number[]): PdfRect => [
    x - padding,
    y1!,
    x + padding,
    y2!,
  ];
  return [
    {
      grip: "start",
      pageIndex: position.pageIndex,
      rect: strip(first[0], first),
    },
    {
      grip: "end",
      pageIndex: position.pageIndex + (spilled ? 1 : 0),
      rect: strip(last[2], last),
    },
  ];
}

/**
 * The end of a text range a press takes: the start first, so it wins where a
 * one-character range's strips overlap, as in Zotero's reader.
 *
 * @param pointOn the press in PDF points on a page, or `null` for a page the
 *   press cannot be placed on.
 * @returns `null` for a press on neither strip.
 */
export function rangeGripAt(
  handles: readonly { grip: RangeGrip; pageIndex: number; rect: PdfRect }[],
  pointOn: (pageIndex: number) => PdfPoint | null,
): RangeGrip | null {
  for (const { grip, pageIndex, rect } of handles) {
    const point = pointOn(pageIndex);
    if (
      point &&
      point[0] >= rect[0] &&
      point[0] <= rect[2] &&
      point[1] >= rect[1] &&
      point[1] <= rect[3]
    )
      return grip;
  }
  return null;
}

/**
 * Whether a press on the selected mark's body moves it. An image and ink move
 * by their body; the body of a highlight or underline is the text selection's.
 */
export function movesByBody(type: AnnotationRecord["type"]): boolean {
  return type === "image" || type === "ink";
}

/**
 * The box a press on the selected mark's body takes, in PDF points: an image's
 * rect, or ink's stroke box padded out as its handles are.
 *
 * @returns `null` for a mark that does not move by its body.
 */
export function bodyRect({
  type,
  position,
}: Pick<AnnotationRecord, "type" | "position">): PdfRect | null {
  if (!movesByBody(type)) return null;
  if (position.kind === "pdf-ink") {
    const box = inkBox(position);
    return box && pad(box);
  }
  const rect = position.kind === "pdf-rects" ? position.rects[0] : undefined;
  return rect ? [rect[0], rect[1], rect[2], rect[3]] : null;
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
 * box; a moved rect stops flush with the view box. Ink moves every stroke point
 * the same way, and scales from a corner as {@link proposeInk} lays out.
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
  // A text range's end is placed on its characters, not by the travel.
  if (isRangeGrip(grip)) return confirmed;
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  if (confirmed.kind === "pdf-ink")
    return proposeInk(confirmed, { grip, travel: [dx, dy], viewBox });
  const rect = confirmed.rects[0];
  if (!rect) return confirmed;
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
 * The ink a drag proposes. The body carries every stroke point by the travel,
 * stopping when the stroke box meets the page's view box. A corner scales the
 * strokes with their proportions held, about the opposite corner: the
 * horizontal travel sets the new width and the height follows it, as in
 * Zotero's reader. The scale stops where either side of the box would fall
 * below one point, where Zotero holds only the width to it.
 *
 * @see ~/repo/zotlit-repo/zotero/reader/src/pdf/pdf-view.js — `_handlePointerMove`, the `resize` and `moveAndDrag` branches for `ink`
 */
function proposeInk(
  confirmed: PdfInkPosition,
  {
    grip,
    travel: [dx, dy],
    viewBox,
  }: { grip: Grip; travel: PdfPoint; viewBox: readonly number[] },
): PdfInkPosition {
  const box = inkBox(confirmed);
  if (!box) return confirmed;
  const [x1, y1, x2, y2] = box;
  if (grip === "body") {
    const [left = 0, bottom = 0, right = 0, top = 0] = viewBox;
    const mx = clamp(dx, left - x1, right - x2);
    const my = clamp(dy, bottom - y1, top - y2);
    return transformInk(confirmed, [1, 0, 0, 1, mx, my]);
  }
  const width = x2 - x1;
  const height = y2 - y1;
  if (width === 0 || height === 0 || grip.length !== 2) return confirmed;
  const left = grip.includes("l");
  const reached = left ? width - dx : width + dx;
  const scale = Math.max(
    reached / width,
    MIN_INK_SIZE / width,
    MIN_INK_SIZE / height,
  );
  // The corner opposite the held one stays where it is.
  const ax = left ? x2 : x1;
  const ay = grip.includes("b") ? y2 : y1;
  return transformInk(confirmed, [
    scale,
    0,
    0,
    scale,
    ax - ax * scale,
    ay - ay * scale,
  ]);
}

/**
 * Every stroke point of an ink position carried through a PDF matrix `[a, b,
 * c, d, e, f]`, and its width by the square root of the area the matrix
 * scales by.
 *
 * @see ~/repo/zotlit-repo/zotero/reader/src/pdf/lib/path.js — `applyTransformationMatrixToInkPosition`
 */
function transformInk(
  position: PdfInkPosition,
  [a, b, c, d, e, f]: readonly [number, number, number, number, number, number],
): PdfInkPosition {
  return {
    ...position,
    paths: position.paths.map((path) => {
      const next: number[] = [];
      for (let index = 0; index + 1 < path.length; index += 2) {
        const x = path[index]!;
        const y = path[index + 1]!;
        next.push(a * x + c * y + e, b * x + d * y + f);
      }
      return next;
    }),
    width: position.width * Math.sqrt(Math.abs(a * d - b * c)),
  };
}

/**
 * The box round every stroke point, in PDF points, or `null` for ink with no
 * point at all.
 */
function inkBox({ paths }: PdfInkPosition): PdfRect | null {
  let box: PdfRect | null = null;
  for (const path of paths) {
    for (let index = 0; index + 1 < path.length; index += 2) {
      const x = path[index]!;
      const y = path[index + 1]!;
      box = box
        ? [
            Math.min(box[0], x),
            Math.min(box[1], y),
            Math.max(box[2], x),
            Math.max(box[3], y),
          ]
        : [x, y, x, y];
    }
  }
  return box;
}

/** A box grown by {@link INK_BOX_PADDING} on every side. */
function pad([x1, y1, x2, y2]: PdfRect): PdfRect {
  const p = INK_BOX_PADDING;
  return [x1 - p, y1 - p, x2 + p, y2 + p];
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
  if (isRangeGrip(grip)) return turned ? "ns-resize" : "ew-resize";
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
