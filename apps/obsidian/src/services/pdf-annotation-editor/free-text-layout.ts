// Where a free-text Annotation's lines, its ring and its hit box sit on a page,
// and the box Zotero fits its text into. The fitting and the line breaking
// measure text through an injected function, so they hold no DOM.
import type { PdfTextPosition } from "@zotlit/db";

import type { PdfRect } from "./geometry-edit";

/** A point in one page's own units, `[x, y]`. */
export type PagePoint = readonly [number, number];

/** Four numbers bounding a box, two opposite corners' `x` and `y` in turn. */
type Box = readonly [number, number, number, number];

/** A box in one page's own units, `[left, top, right, bottom]`. */
export type PageRect = Box;

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
  // PDF measures its y upwards and the page measures it downwards, so the
  // stored angle reads the other way round here.
  const angle = -position.rotation;
  const storedTurn: Turn[] =
    angle === 0 ? [] : [{ angle, pivot: centreOf(rect) }];

  const baseline = toPagePoint(left, top - position.fontSize);
  const reading = readingAngle(toPagePoint, left, top);

  return {
    baseline,
    turns:
      reading === 0
        ? storedTurn
        : [...storedTurn, { angle: reading, pivot: baseline }],
    ring: { rect: grow(rect, padding), turns: storedTurn },
    hit: turnedBounds(rect, angle),
  };
}

/** Where the page's own turn points the reading direction, in degrees. */
export function readingAngle(
  toPagePoint: ToPagePoint,
  left: number,
  top: number,
): number {
  const [ox, oy] = toPagePoint(left, top);
  const [ux, uy] = toPagePoint(left + 1, top);
  return Math.round((Math.atan2(uy - oy, ux - ox) * 180) / Math.PI);
}

/**
 * The axis-aligned box a box sweeps out, turned by `angle` degrees about its
 * own centre, from the first axis towards the second.
 */
function turnedBounds(box: Box, angle: number): Box {
  if (angle === 0) return box;
  const turn = turnBy(angle);
  const [cx, cy] = centreOf(box);
  const [x1, y1, x2, y2] = box;
  const corners = (
    [
      [x1, y1],
      [x2, y1],
      [x2, y2],
      [x1, y2],
    ] as const
  ).map(([x, y]) => turn(x - cx, y - cy));
  const xs = corners.map(([x]) => cx + x);
  const ys = corners.map(([, y]) => cy + y);
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

function centreOf([x1, y1, x2, y2]: Box): readonly [number, number] {
  return [(x1 + x2) / 2, (y1 + y2) / 2];
}

function grow([left, top, right, bottom]: PageRect, by: number): PageRect {
  return [left - by, top - by, right + by, bottom + by];
}

/** The width of one run of text at a font size, in the same units as the size. */
export type TextMeasure = (text: string, fontSize: number) => number;

/** A measure and the font size it measures at. */
interface SizedMeasure {
  fontSize: number;
  measure: TextMeasure;
}

/**
 * The height of one line, in font sizes, as Zotero's reader draws free text.
 *
 * @see https://github.com/zotero/reader/blob/df215c60334d2d0c7b1fbc9f3959b66afc1ced83/src/pdf/lib/render.js#L173
 */
export const LINE_HEIGHT = 1.2;

/**
 * The lines a free-text Annotation shows in a box `width` wide, broken as
 * Zotero's canvas render breaks them: at each newline, then between words,
 * then inside a word too long for a line of its own.
 *
 * Two changes from `calculateLines`: it splits at newlines first, since a
 * canvas draws a newline as nothing; and it measures a line without the space
 * it ends on, as Zotero's on-screen textarea does, so a box fitted to a line's
 * width holds that line.
 *
 * @see https://github.com/zotero/reader/blob/df215c60334d2d0c7b1fbc9f3959b66afc1ced83/src/pdf/lib/render.js#L10-L45
 */
export function freeTextLines(
  text: string,
  width: number,
  { fontSize, measure }: SizedMeasure,
): string[] {
  const fits = (run: string) => measure(run, fontSize) <= width;
  return text.split("\n").flatMap((paragraph) => {
    const lines: string[] = [];
    let line = "";
    for (const word of paragraph.split(" ")) {
      if (fits(line + word)) {
        line += `${word} `;
      } else if (line.trim() === "") {
        // A word alone too wide for the line breaks between its characters.
        let part = "";
        for (const char of word) {
          if (fits(part + char)) {
            part += char;
          } else {
            lines.push(part);
            part = char;
          }
        }
        line = `${part} `;
      } else {
        lines.push(line.trim());
        line = `${word} `;
      }
    }
    lines.push(line.trim());
    return lines;
  });
}

/** How far inside the page box a fitted box is kept, in points. */
const PAGE_INSET = 5;

/** The widest a box sized to one line grows before its text wraps. */
const MAX_LINE_WIDTH = 300;

/** The room left after a line's measured width, in points. */
const LINE_PADDING = 5;

/**
 * The box Zotero's reader fits a free-text Annotation's text into after the
 * text changes, as its comment edit fits it.
 *
 * A box at least two font sizes high keeps its width, and its height follows
 * the lines laid out in it. Any other box is sized to the text's widest line
 * plus 5 points, and from 300 points on wraps at 300. Either way the box keeps
 * its top-left corner where it was on the page, turned as it is, and is kept 5
 * points inside the page box: a box that kept its width moves back in, and a
 * box sized to its text changes width by what it reached past the side, as
 * Zotero's does.
 *
 * Text its newlines already make two font sizes tall keeps its widest line's
 * width exactly: Zotero adds the 5 points only to a box its height rule finds
 * one line high.
 *
 * Zotero measures a textarea, whose scroll width it rounds up by a point; the
 * measure here is exact, so that point is left out. The rects are left
 * unrounded, since a write rounds them.
 *
 * @param position the text position before the text changed: its box, the
 *   box's turn in degrees counter-clockwise, and its font size.
 * @param options.pageBox the page's view box, in PDF points.
 * @see https://github.com/zotero/reader/blob/df215c60334d2d0c7b1fbc9f3959b66afc1ced83/src/pdf/lib/text-annotation.js
 */
export function fitFreeTextBox(
  text: string,
  {
    rects,
    rotation,
    fontSize,
  }: Pick<PdfTextPosition, "rects" | "rotation" | "fontSize">,
  { measure, pageBox }: { measure: TextMeasure; pageBox: readonly number[] },
): PdfRect {
  const old: PdfRect = rects[0]!;
  const [left, bottom, right, top] = old;
  const font = { fontSize, measure };
  // Zotero measures an empty text as one letter.
  const measured = text || "A";
  const widest = () =>
    Math.max(...measured.split("\n").map((line) => measure(line, fontSize)));
  const heightAt = (width: number) =>
    freeTextLines(measured, width, font).length * LINE_HEIGHT * fontSize;

  const keepsWidth = top - bottom >= 2 * fontSize;
  let width = keepsWidth ? right - left : widest();
  let height = heightAt(width);
  if (height < 2 * fontSize && !keepsWidth) {
    width = widest() + LINE_PADDING;
    if (width > MAX_LINE_WIDTH) {
      width = MAX_LINE_WIDTH;
      height = heightAt(width);
    }
  }

  const anchored = anchorTopLeft(old, rotation, [width, height]);
  const [dx, dy] = backInside(turnedBounds(anchored, rotation), boxOf(pageBox));
  if (keepsWidth) {
    return [
      anchored[0] + dx,
      anchored[1] + dy,
      anchored[2] + dx,
      anchored[3] + dy,
    ];
  }
  width += dx;
  return anchorTopLeft(old, rotation, [width, heightAt(width)]);
}

function boxOf([x1, y1, x2, y2]: readonly number[]): Box {
  return [x1!, y1!, x2!, y2!];
}

/**
 * A `width` × `height` box whose top-left corner, turned about the box's own
 * centre, lands where `old`'s turned top-left corner does.
 */
function anchorTopLeft(
  old: PdfRect,
  rotation: number,
  [width, height]: readonly [number, number],
): PdfRect {
  const turn = turnBy(rotation);
  const [oldX, oldY] = centreOf(old);
  const [ax, ay] = turn(old[0] - oldX, old[3] - oldY);
  const [cx, cy] = turn(-width / 2, height / 2);
  const [x, y] = [oldX + ax - cx, oldY + ay - cy];
  return [x - width / 2, y - height / 2, x + width / 2, y + height / 2];
}

/** How far a box moves to sit `PAGE_INSET` inside the page box, `[dx, dy]`. */
function backInside(
  [left, bottom, right, top]: Readonly<PdfRect>,
  pageBox: Readonly<PdfRect>,
): [number, number] {
  const [pageLeft, pageBottom, pageRight, pageTop] = grow(pageBox, -PAGE_INSET);
  const dx =
    left < pageLeft
      ? pageLeft - left
      : right > pageRight
        ? pageRight - right
        : 0;
  const dy =
    bottom < pageBottom
      ? pageBottom - bottom
      : top > pageTop
        ? pageTop - top
        : 0;
  return [dx, dy];
}

/** A turn by `degrees`, from the first axis towards the second. */
function turnBy(degrees: number) {
  const radians = (degrees * Math.PI) / 180;
  const [cos, sin] = [Math.cos(radians), Math.sin(radians)];
  return (x: number, y: number): [number, number] => [
    x * cos - y * sin,
    x * sin + y * cos,
  ];
}
