// The arithmetic of a Geometry Edit: where a selected mark's Mark Handles sit,
// which grip a press takes, and the position a drag proposes. Ported from
// Zotero's reader so a mark adjusted in either application lands the same.
//
// @see https://github.com/aidenlx/zotlit/issues/1200
import type {
  AnnotationPosition,
  PdfInkPosition,
  PdfRectsPosition,
  PdfTextPosition,
} from "@zotlit/db";

import type { AnnotationRecord } from "@/services/annotation-repository/service";
import { writePosition } from "@/services/annotation-repository/write";

import {
  anchorCorner,
  fitStoredTextBox,
  turnAbout,
  turnBy,
  turnedBounds,
} from "./free-text-layout";
import type { Corner, FitMode, TextMeasure } from "./free-text-layout";
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
export type EditablePosition =
  | PdfRectsPosition
  | PdfInkPosition
  | PdfTextPosition;

/**
 * What a free-text box's height is fitted to after a Geometry Edit: its
 * comment, measured as it is drawn. Every edit takes it; only a free-text
 * box's reads it.
 */
export interface FreeTextContent {
  comment: string;
  measure: TextMeasure;
}

/** A rect in PDF points, `[x1, y1, x2, y2]`. */
export type PdfRect = [number, number, number, number];

/** The text rotation under a rect on a page, in degrees. */
export type TextRotation = (pageIndex: number, rect: PdfRect) => number;

/** Whether a Geometry Edit can propose a position of this shape. */
export function isEditablePosition(
  position: AnnotationPosition,
): position is EditablePosition {
  return (
    position.kind === "pdf-rects" ||
    position.kind === "pdf-ink" ||
    position.kind === "pdf-text"
  );
}

/**
 * Half the width of a text range's handle strip, in CSS pixels, as Zotero's
 * reader pads the edge it lays the strip along.
 *
 * @see https://github.com/zotero/reader/blob/df215c60334d2d0c7b1fbc9f3959b66afc1ced83/src/pdf/pdf-view.js — `getSelectedAnnotationAction`, `padding = 3`
 */
export const RANGE_HANDLE_PADDING = 3;

/**
 * The smallest side an image rect may be resized to, in PDF points.
 *
 * @see https://github.com/zotero/reader/blob/df215c60334d2d0c7b1fbc9f3959b66afc1ced83/src/common/defines.js — `MIN_IMAGE_ANNOTATION_SIZE`
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
 * @see https://github.com/zotero/reader/blob/df215c60334d2d0c7b1fbc9f3959b66afc1ced83/src/pdf/pdf-view.js — `getSelectedAnnotationAction`, `BOX_PADDING`
 */
export const INK_BOX_PADDING = 5;

/**
 * The narrowest a free-text box may be resized to, in PDF points.
 *
 * @see https://github.com/zotero/reader/blob/df215c60334d2d0c7b1fbc9f3959b66afc1ced83/src/common/defines.js — `MIN_TEXT_ANNOTATION_WIDTH`
 */
export const MIN_TEXT_ANNOTATION_WIDTH = 10;

/**
 * The smallest side an ink scale may leave, in PDF points.
 *
 * @see https://github.com/zotero/reader/blob/df215c60334d2d0c7b1fbc9f3959b66afc1ced83/src/pdf/pdf-view.js — `_handlePointerMove`, the `resize` branch for `ink`
 */
export const MIN_INK_SIZE = 1;

/**
 * The order Zotero's reader tries the handles in: corners first, so a corner
 * wins a point an edge midpoint also covers.
 *
 * @see https://github.com/zotero/reader/blob/df215c60334d2d0c7b1fbc9f3959b66afc1ced83/src/pdf/pdf-view.js — `getSelectedAnnotationAction`
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
 * proportional scale can keep. A free-text box shows four corners and the
 * middles of its left and right sides on its rect, padded out as ink's box is
 * and turned with the box about its centre. A note, which only moves, and a
 * mark this build cannot yet adjust show none.
 *
 * @see https://github.com/zotero/reader/blob/df215c60334d2d0c7b1fbc9f3959b66afc1ced83/src/pdf/pdf-view.js — `getSelectedAnnotationAction`, the `image`, `text` and `ink` branch
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
  if (type === "text" && position.kind === "pdf-text") {
    const rect = position.rects[0];
    if (!rect) return [];
    const [x1, y1, x2, y2] = pad([rect[0], rect[1], rect[2], rect[3]]);
    const turned = turnAbout([x1, y1, x2, y2], position.rotation);
    const ym = (y1 + y2) / 2;
    return (
      [
        ["tl", [x1, y2]],
        ["tr", [x2, y2]],
        ["br", [x2, y1]],
        ["bl", [x1, y1]],
        ["l", [x1, ym]],
        ["r", [x2, ym]],
      ] as const
    ).map(([grip, at]) => ({ grip, at: turned(at) }));
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
 * Each strip lies across the text's own direction, as Zotero's reader turns
 * it by the text rotation of the characters under its rect: upright text
 * reads left to right, so its start stands on the rect's left edge; text
 * turned a quarter turn reads up the page, so its start stands on the rect's
 * foot. Zotero adds the page's rotation because it lays the strip out on
 * screen; this lays it out in PDF points, which the page's rotation turns as
 * it turns the rect.
 *
 * @param padding half the strip's width, in PDF points.
 * @see https://github.com/zotero/reader/blob/df215c60334d2d0c7b1fbc9f3959b66afc1ced83/src/pdf/pdf-view.js — `getSelectedAnnotationAction`, the `highlight` and `underline` branch
 */
export function rangeHandles(
  { type, position }: Pick<AnnotationRecord, "type" | "position">,
  padding: number,
  rotationOf: TextRotation,
): { grip: RangeGrip; pageIndex: number; rect: PdfRect; rotation: number }[] {
  if (type !== "highlight" && type !== "underline") return [];
  if (position.kind !== "pdf-rects") return [];
  const first = position.rects[0];
  const spilled = position.nextPageRects?.length
    ? position.nextPageRects
    : undefined;
  const last = (spilled ?? position.rects).at(-1);
  if (!first || !last) return [];
  const handle = (
    grip: RangeGrip,
    pageIndex: number,
    held: readonly number[],
  ) => {
    const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = held;
    const rotation = rotationOf(pageIndex, [x1, y1, x2, y2]);
    // The edge the text starts from, or, for the end, the one it runs to.
    const edge = grip === "start" ? rotation : (rotation + 180) % 360;
    const rect: PdfRect =
      edge === 90
        ? [x1, y1 - padding, x2, y1 + padding]
        : edge === 180
          ? [x2 - padding, y1, x2 + padding, y2]
          : edge === 270
            ? [x1, y2 - padding, x2, y2 + padding]
            : [x1 - padding, y1, x1 + padding, y2];
    return { grip, pageIndex, rect, rotation };
  };
  return [
    handle("start", position.pageIndex, first),
    handle("end", position.pageIndex + (spilled ? 1 : 0), last),
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
 * What a Geometry Edit may do to each kind of mark: whether a press on its
 * body, or `Alt` and an arrow, moves it, and whether its handles or `Shift`
 * and an arrow resize it. The body of a highlight or underline is the text
 * selection's, and its handles move an end of its range; a note only moves.
 */
const GEOMETRY_EDITS = {
  highlight: { moves: false, resizes: false },
  underline: { moves: false, resizes: false },
  note: { moves: true, resizes: false },
  text: { moves: true, resizes: true },
  image: { moves: true, resizes: true },
  ink: { moves: true, resizes: true },
  unknown: { moves: false, resizes: false },
} as const satisfies Record<
  AnnotationRecord["type"],
  { moves: boolean; resizes: boolean }
>;

/** Whether a press on the selected mark's body moves it. */
export function movesByBody(type: AnnotationRecord["type"]): boolean {
  return GEOMETRY_EDITS[type].moves;
}

/** Whether a kind of mark can be resized. */
export function resizes(type: AnnotationRecord["type"]): boolean {
  return GEOMETRY_EDITS[type].resizes;
}

/**
 * The box a press on the selected mark's body takes, in PDF points: an image's
 * or a note's rect, ink's stroke box padded out as its handles are, or the box
 * a free-text rect, padded out the same way, sweeps out as it is turned.
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
  const rect =
    position.kind === "pdf-rects" || position.kind === "pdf-text"
      ? position.rects[0]
      : undefined;
  if (!rect) return null;
  const box: PdfRect = [rect[0], rect[1], rect[2], rect[3]];
  return position.kind === "pdf-text"
    ? [...turnedBounds(pad(box), position.rotation)]
    : box;
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
 * the same way, and scales from a corner as {@link proposeInk} lays out. A
 * free-text box is resized as {@link resizeText} lays out, and moves as a
 * rect does, stopping where the box it sweeps out as turned meets the view
 * box.
 *
 * @param options.from where the press fell, in PDF points on the mark's page.
 * @param options.to where the pointer is now, on the same page.
 * @param options.viewBox the page's `[x1, y1, x2, y2]` in PDF points.
 * @param options.text what a free-text box's height is fitted to after its
 *   side moves.
 * @see https://github.com/zotero/reader/blob/df215c60334d2d0c7b1fbc9f3959b66afc1ced83/src/pdf/pdf-view.js — `_handlePointerMove`, the `resize` branch for `image`
 */
export function proposePosition({
  confirmed,
  grip,
  from,
  to,
  viewBox,
  text,
}: {
  confirmed: EditablePosition;
  grip: Grip;
  from: PdfPoint;
  to: PdfPoint;
  viewBox: readonly number[];
  text: FreeTextContent;
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
    const [bx1, by1, bx2, by2] =
      confirmed.kind === "pdf-text"
        ? turnedBounds([x1, y1, x2, y2], confirmed.rotation)
        : rect;
    const mx = clamp(dx, left - bx1, right - bx2);
    const my = clamp(dy, bottom - by1, top - by2);
    return { ...confirmed, rects: [[x1 + mx, y1 + my, x2 + mx, y2 + my]] };
  }
  if (confirmed.kind === "pdf-text") {
    // The travel along the box's own width, as Zotero measures the pointer
    // in the frame the box is turned into.
    const [along] = turnBy(-confirmed.rotation)(dx, dy);
    return resizeText(confirmed, {
      grip,
      along,
      round: Math.floor,
      viewBox,
      text,
    });
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
 * The position a released drag saves: a free-text box whose side was dragged
 * is sized to its text once more, as a comment edit sizes it, but with no
 * 300-point cap; any other proposal saves as it stands.
 *
 * @param options.viewBox the page's `[x1, y1, x2, y2]` in PDF points.
 * @see https://github.com/zotero/reader/blob/df215c60334d2d0c7b1fbc9f3959b66afc1ced83/src/pdf/pdf-view.js — `_handlePointerUp`, the `resize` branch
 */
export function releasedPosition({
  proposal,
  grip,
  viewBox,
  text,
}: {
  proposal: EditablePosition;
  grip: Grip;
  viewBox: readonly number[];
  text: FreeTextContent;
}): EditablePosition {
  if (proposal.kind !== "pdf-text" || (grip !== "l" && grip !== "r"))
    return proposal;
  return {
    ...proposal,
    rects: [fitText(proposal, { text, viewBox, mode: "single-line" })],
  };
}

/**
 * The rectangle an image capture drags out: the box between the press and
 * the pointer, in PDF points on the press page, held inside that page's view
 * box. Zotero's reader clamps to the page under the pointer; the press page
 * is the one the capture belongs to, so it is the one held here.
 *
 * @param options.from where the press fell, in PDF points on its page.
 * @param options.to where the pointer is now, measured on the same page.
 * @param options.viewBox the press page's `[x1, y1, x2, y2]` in PDF points.
 * @see https://github.com/zotero/reader/blob/df215c60334d2d0c7b1fbc9f3959b66afc1ced83/src/pdf/pdf-view.js — `_handlePointerMove`, the `image` branch
 */
export function captureRect({
  from,
  to,
  viewBox,
}: {
  from: PdfPoint;
  to: PdfPoint;
  viewBox: readonly number[];
}): PdfRect {
  const [left = 0, bottom = 0, right = 0, top = 0] = viewBox;
  return [
    Math.max(Math.min(from[0], to[0]), left),
    Math.max(Math.min(from[1], to[1]), bottom),
    Math.min(Math.max(from[0], to[0]), right),
    Math.min(Math.max(from[1], to[1]), top),
  ];
}

/**
 * Whether a captured rectangle is big enough to keep as an image: both sides
 * at least {@link MIN_IMAGE_ANNOTATION_SIZE}.
 *
 * @see https://github.com/zotero/reader/blob/df215c60334d2d0c7b1fbc9f3959b66afc1ced83/src/pdf/pdf-view.js — `_handlePointerUp`, the `image` branch
 */
export function capturesImage([x1, y1, x2, y2]: readonly number[]): boolean {
  return (
    x2! - x1! >= MIN_IMAGE_ANNOTATION_SIZE &&
    y2! - y1! >= MIN_IMAGE_ANNOTATION_SIZE
  );
}

/** An arrow key, by the way it points on the page. */
export type Arrow = "left" | "right" | "up" | "down";

/**
 * How far one key press moves or resizes an image or ink, in PDF points.
 *
 * @see https://github.com/zotero/reader/blob/df215c60334d2d0c7b1fbc9f3959b66afc1ced83/src/pdf/pdf-view.js — `_handleKeyDown`, `STEP`
 */
export const KEY_STEP = 5;

/**
 * How close to the page's edge a nudge may bring a mark, in PDF points.
 *
 * @see https://github.com/zotero/reader/blob/df215c60334d2d0c7b1fbc9f3959b66afc1ced83/src/pdf/pdf-view.js — `_handleKeyDown`, `PADDING`
 */
export const KEY_PADDING = 5;

/**
 * The Geometry Edit a modified arrow key asks of the selected mark: one end
 * of a text range stepped, an image or ink resized, or either nudged.
 */
export type KeyEdit =
  | { kind: "range"; end: RangeGrip }
  | { kind: "resize" }
  | { kind: "nudge" };

/**
 * Which Geometry Edit a modified arrow key asks of a kind of mark, as
 * Zotero's reader reads its keys: `Shift` moves the end of a highlight's or
 * underline's range, and `Mod`+`Shift` its start; `Shift` resizes an image,
 * ink or a free-text box, and `Alt` nudges any mark that moves by its body.
 *
 * @param modifiers the keys held, `mod` being the platform's command key.
 * @returns `null` for a chord that asks no edit of this mark: a plain arrow,
 *   which walks the reading order, among them.
 * @see https://github.com/zotero/reader/blob/df215c60334d2d0c7b1fbc9f3959b66afc1ced83/src/pdf/pdf-view.js — `_handleKeyDown`
 */
export function keyEdit(
  type: AnnotationRecord["type"],
  { shift, alt, mod }: { shift: boolean; alt: boolean; mod: boolean },
): KeyEdit | null {
  if (type === "highlight" || type === "underline") {
    return shift && !alt ? { kind: "range", end: mod ? "start" : "end" } : null;
  }
  if (!movesByBody(type) || mod || shift === alt) return null;
  if (!shift) return { kind: "nudge" };
  return resizes(type) ? { kind: "resize" } : null;
}

/**
 * The position one key press proposes for an image or ink, and the grip the
 * press stands for.
 *
 * `resize` grows or shrinks by {@link KEY_STEP}, as Zotero's reader does: an
 * image's right edge follows Right and Left and its foot follows Down and
 * Up, held at ten points and the view box as a drag is; ink scales with its
 * proportions held about its top-left corner, Right and Left by five points
 * of width and Down and Up by five points of height. A free-text box's right
 * side follows Right and Left, held at ten points and fitted to its text as
 * a drag fits it; Down and Up scale it by five points of width about its
 * top-left corner, the font rounded to the half point.
 *
 * `nudge` moves the mark by {@link KEY_STEP}, and not at all while the side
 * it moves to stands within a step and a {@link KEY_PADDING} of the view box.
 * Zotero measures that from the page's origin; this measures it from the
 * view box's own edge, which is the same on a page drawn from the origin.
 *
 * @returns `null` for a refused nudge, and for a mark keys do not move.
 * @see https://github.com/zotero/reader/blob/df215c60334d2d0c7b1fbc9f3959b66afc1ced83/src/pdf/pdf-view.js — `_handleKeyDown`
 */
export function keyedPosition({
  confirmed,
  edit,
  arrow,
  viewBox,
  text,
}: {
  confirmed: EditablePosition;
  edit: "resize" | "nudge";
  arrow: Arrow;
  viewBox: readonly number[];
  text: FreeTextContent;
}): { grip: Grip; proposal: EditablePosition } | null {
  const box =
    confirmed.kind === "pdf-ink"
      ? inkBox(confirmed)
      : (confirmed.rects[0] ?? null);
  if (!box) return null;
  const [x1, y1, x2, y2] = box;
  const step = KEY_STEP;
  const propose = (grip: Grip, [dx, dy]: PdfPoint) => ({
    grip,
    proposal: proposePosition({
      confirmed,
      grip,
      from: [0, 0],
      to: [dx, dy],
      viewBox,
      text,
    }),
  });
  if (edit === "nudge") {
    const [left = 0, bottom = 0, right = 0, top = 0] = viewBox;
    const room = step + KEY_PADDING;
    const allowed =
      arrow === "left"
        ? x1 - left >= room
        : arrow === "right"
          ? right - x2 >= room
          : arrow === "down"
            ? y1 - bottom >= room
            : top - y2 >= room;
    if (!allowed) return null;
    const [dx, dy] = ARROW_TRAVEL[arrow];
    return propose("body", [dx * step, dy * step]);
  }
  if (confirmed.kind === "pdf-text") {
    const grip = arrow === "left" || arrow === "right" ? "r" : "br";
    const along = arrow === "left" || arrow === "up" ? -step : step;
    return {
      grip,
      proposal: resizeText(confirmed, {
        grip,
        along,
        round: Math.round,
        viewBox,
        text,
      }),
    };
  }
  if (confirmed.kind === "pdf-ink") {
    // The top-left stays: the bottom-right corner is what scales. Down and Up
    // step the height, which the proportions turn into width.
    const ratio = (x2 - x1) / (y2 - y1);
    const width =
      arrow === "right"
        ? step
        : arrow === "left"
          ? -step
          : arrow === "down"
            ? step * ratio
            : -step * ratio;
    return propose("br", [width, 0]);
  }
  const [dx, dy] = ARROW_TRAVEL[arrow];
  return arrow === "left" || arrow === "right"
    ? propose("r", [dx * step, 0])
    : propose("b", [0, dy * step]);
}

/** Which way an arrow points in PDF space, which counts up from the foot. */
const ARROW_TRAVEL: Record<Arrow, PdfPoint> = {
  left: [-1, 0],
  right: [1, 0],
  up: [0, 1],
  down: [0, -1],
};

/**
 * The ink a drag proposes. The body carries every stroke point by the travel,
 * stopping when the stroke box meets the page's view box. A corner scales the
 * strokes with their proportions held, about the opposite corner: the
 * horizontal travel sets the new width and the height follows it, as in
 * Zotero's reader. The scale stops where either side of the box would fall
 * below one point, where Zotero holds only the width to it.
 *
 * @see https://github.com/zotero/reader/blob/df215c60334d2d0c7b1fbc9f3959b66afc1ced83/src/pdf/pdf-view.js — `_handlePointerMove`, the `resize` and `moveAndDrag` branches for `ink`
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
 * A free-text box with one handle carried `along` its own width, in the frame
 * it is turned into. A side changes the width, held at
 * {@link MIN_TEXT_ANNOTATION_WIDTH}, keeps the font, and fits the height to
 * the text at that width. A corner sets the width the same way, the height
 * following with the box's proportions, and scales the font by as much. The
 * corner or side opposite the held one stays where it stood on the page,
 * turned as the box is.
 *
 * Zotero measures the scale between the two boxes' proportions, which a
 * corner holds, so it is the ratio of the widths here.
 *
 * @param options.round how the scaled font meets the half point: down for a
 *   drag, to the nearest for a key.
 * @see https://github.com/zotero/reader/blob/df215c60334d2d0c7b1fbc9f3959b66afc1ced83/src/pdf/pdf-view.js — `_handlePointerMove`, the `resize` branch for `text`, and `_handleKeyDown`
 * @see https://github.com/zotero/reader/blob/df215c60334d2d0c7b1fbc9f3959b66afc1ced83/src/pdf/lib/utilities.js — `adjustRectHeightByRatio`, `getScaleTransform`, `calculateScale`
 */
function resizeText(
  confirmed: PdfTextPosition,
  {
    grip,
    along,
    round,
    viewBox,
    text,
  }: {
    grip: Handle;
    along: number;
    round: (value: number) => number;
    viewBox: readonly number[];
    text: FreeTextContent;
  },
): PdfTextPosition {
  const rect = confirmed.rects[0];
  if (!rect) return confirmed;
  const [x1, y1, x2, y2] = rect;
  const width = x2 - x1;
  const reached = Math.max(
    grip.includes("l") ? width - along : width + along,
    MIN_TEXT_ANNOTATION_WIDTH,
  );
  const { rotation, fontSize } = confirmed;
  const old: PdfRect = [x1, y1, x2, y2];
  if (grip.length === 2) {
    const scaled = round(fontSize * (reached / width) * 2) / 2;
    return {
      ...confirmed,
      // Zotero keeps the font a scale rounds to nothing.
      fontSize: scaled || fontSize,
      rects: [
        anchorCorner(old, [reached, (reached * (y2 - y1)) / width], {
          rotation,
          corner: OPPOSITE[grip as Corner],
        }),
      ],
    };
  }
  // Zotero's `l` holds the bottom-right corner and its `r` the top-left; the
  // height is the same, so either way the far side stays.
  const moved = anchorCorner(old, [reached, y2 - y1], {
    rotation,
    corner: grip === "l" ? "br" : "tl",
  });
  const sided = { ...confirmed, rects: [moved] };
  return {
    ...sided,
    rects: [fitText(sided, { text, viewBox, mode: "keep-width" })],
  };
}

/** The corner a corner handle's scale holds still. */
const OPPOSITE: Record<Corner, Corner> = {
  tl: "br",
  tr: "bl",
  br: "tl",
  bl: "tr",
};

/** {@link fitStoredTextBox} over a Geometry Edit's free-text content. */
function fitText(
  position: PdfTextPosition,
  {
    text,
    viewBox,
    mode,
  }: { text: FreeTextContent; viewBox: readonly number[]; mode: FitMode },
): PdfRect {
  return fitStoredTextBox(text.comment, position, {
    measure: text.measure,
    pageBox: viewBox,
    mode,
  });
}

/**
 * Every stroke point of an ink position carried through a PDF matrix `[a, b,
 * c, d, e, f]`, and its width by the square root of the area the matrix
 * scales by.
 *
 * @see https://github.com/zotero/reader/blob/df215c60334d2d0c7b1fbc9f3959b66afc1ced83/src/pdf/lib/path.js — `applyTransformationMatrixToInkPosition`
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

/** A box grown by {@link INK_BOX_PADDING} on every side, as ink's and free text's are. */
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
