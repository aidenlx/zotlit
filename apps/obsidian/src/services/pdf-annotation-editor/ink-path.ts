// The pure geometry of an ink stroke in PDF points: Zotero's smoothing, the
// sample filter and page clamp a stroke is drawn with, the distance its hit
// test measures, and the size ceiling its write must fit under.
import {
  MAX_POSITION_LENGTH,
  roundCoordinate,
  writePosition,
} from "@/services/annotation-repository/write";
import type { InkPosition } from "@/services/annotation-repository/write";

import type { PdfPoint } from "./geometry-edit";

/** How close, in PDF points, two kept points of a stroke may lie. */
const MIN_POINT_DISTANCE = 1;

/**
 * How near an ink stroke a point must fall to take it, at the least, in PDF
 * points: Zotero's floor, which keeps a hairline stroke reachable.
 */
const INK_REACH_FLOOR = 7;

/**
 * A stroke's flat `[x0, y0, x1, y1, …]` run as Zotero stores it: two Chaikin
 * passes that keep the first and the last point, then the points under one
 * PDF point from the last kept one dropped. That filter runs over the last
 * point too, so a stroke's end can be lost.
 *
 * @see https://github.com/zotero/reader/blob/df215c60334d2d0c7b1fbc9f3959b66afc1ced83/src/pdf/lib/path.js#L1-L49
 */
export function smoothPath(points: readonly number[]): number[] {
  return filterClosePoints(chaikin(chaikin(points)));
}

/**
 * Whether a raw pointer sample joins the stroke: the first always does, and
 * any later one only once it is a PDF point or more from the last kept one.
 */
export function keepsSample(
  last: PdfPoint | undefined,
  sample: PdfPoint,
): boolean {
  return last === undefined || apart(last, sample) >= MIN_POINT_DISTANCE;
}

/**
 * A point pulled onto the page, so a stroke that runs off the edge stays on
 * the page it began on.
 *
 * @param viewBox the page's view box, `[x1, y1, x2, y2]` in PDF points.
 */
export function clampToViewBox(
  [x, y]: PdfPoint,
  [x1, y1, x2, y2]: readonly [number, number, number, number],
): PdfPoint {
  return [Math.min(Math.max(x, x1), x2), Math.min(Math.max(y, y1), y2)];
}

/**
 * How far from a stroke a click still takes an ink mark: the pen's full
 * width, and never under Zotero's seven-point floor.
 *
 * @see https://github.com/zotero/reader/blob/df215c60334d2d0c7b1fbc9f3959b66afc1ced83/src/pdf/lib/utilities.js#L138-L148
 */
export function inkReach(width: number): number {
  return Math.max(INK_REACH_FLOOR, width);
}

/**
 * Whether a point lies closer than `reach` to some segment of some stroke.
 * Zotero measures to the vertices; measuring to the segments also reaches the
 * middle of a long segment in sparse imported ink, and a one-point stroke is
 * its single vertex.
 */
export function nearStroke(
  point: PdfPoint,
  paths: readonly (readonly PdfPoint[])[],
  reach: number,
): boolean {
  return paths.some((path) =>
    path.some(
      (from, index) =>
        distanceToSegment(point, from, path[index + 1] ?? from) < reach,
    ),
  );
}

/** How far a point lies from the nearest point of the segment `a`–`b`. */
function distanceToSegment(point: PdfPoint, a: PdfPoint, b: PdfPoint): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = dx * dx + dy * dy;
  if (length === 0) return apart(point, a);
  const t = Math.min(
    Math.max(((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length, 0),
    1,
  );
  return apart(point, [a[0] + t * dx, a[1] + t * dy]);
}

/**
 * Whether the position, rounded and written as a create sends it, stays
 * within the ceiling the repository enforces.
 */
export function fitsPositionBudget(position: InkPosition): boolean {
  return writePosition(position).length <= MAX_POSITION_LENGTH;
}

/**
 * The most stored points one more raw sample can add to a smoothed stroke.
 * Each Chaikin pass turns an appended point into three where the old last one
 * stood, so after two passes the last three smoothed points give way to seven;
 * the close-point filter only drops, and decides the unchanged head as before.
 */
const MAX_POINTS_PER_SAMPLE = 7;

/**
 * The kept samples of one Ink Stroke, which part it where one more sample would
 * carry its written position past the ceiling: the finished part stays within
 * it, and the sample begins the next part.
 *
 * The written length is measured in full only near the ceiling. Each measure
 * leaves the room still free, and every sample after it spends at most the
 * characters seven points of the stroke's widest coordinate take; while that
 * bound fits in the room, the sample is taken unmeasured.
 */
export class StrokeSamples {
  readonly #frame;
  /** The kept samples, a flat `[x0, y0, x1, y1, …]` run in PDF points. */
  #raw: number[] = [];
  /** Characters the written position is known to have left under the ceiling. */
  #room = 0;
  /** The most characters one coordinate of this stroke is written in. */
  #coordinateLength = 0;

  /** @param frame the page and the pen width every part is written with. */
  constructor(frame: { pageIndex: number; width: number }) {
    this.#frame = frame;
  }

  /** The stroke so far as Zotero smooths it, unrounded. */
  get path(): number[] {
    return smoothPath(this.#raw);
  }

  /**
   * Takes one sample, already on the page: dropped under one PDF point from
   * the last kept one, and otherwise kept.
   *
   * @returns the stroke up to this sample, smoothed and rounded, when the
   *   sample would have carried it past the ceiling and began the next part
   *   instead; `null` otherwise.
   */
  take(point: PdfPoint): number[] | null {
    const last: PdfPoint | undefined =
      this.#raw.length > 0 ? [this.#raw.at(-2)!, this.#raw.at(-1)!] : undefined;
    if (!keepsSample(last, point)) return null;
    if (this.#fits(point)) {
      this.#raw.push(...point);
      return null;
    }
    const finished = this.finish();
    this.#raw = [];
    this.#room = 0;
    // A lone point always fits, so the next part begins with this sample.
    this.#fits(point);
    this.#raw.push(...point);
    return finished;
  }

  /** The stroke as Zotero stores it: smoothed, and rounded to three decimals. */
  finish(): number[] {
    return smoothPath(this.#raw).map(roundCoordinate);
  }

  /** Whether the stroke with this sample stays within the ceiling. */
  #fits(point: PdfPoint): boolean {
    this.#coordinateLength = Math.max(
      this.#coordinateLength,
      ...point.map(writtenLength),
    );
    const bound = MAX_POINTS_PER_SAMPLE * 2 * this.#coordinateLength;
    if (bound <= this.#room) {
      this.#room -= bound;
      return true;
    }
    this.#room =
      MAX_POSITION_LENGTH -
      writePosition({
        ...this.#frame,
        paths: [smoothPath([...this.#raw, ...point])],
      }).length;
    return this.#room >= 0;
  }
}

/**
 * The most characters a coordinate no further from zero than `value` is
 * written in once rounded, its comma included. A smoothed point lies between
 * the samples it was cut from, so the widest sample bounds every point.
 */
function writtenLength(value: number): number {
  // Sign, integer part (rounding can carry into one more digit), point, three
  // decimals, comma.
  return 1 + String(Math.trunc(Math.abs(value)) + 1).length + 1 + 3 + 1;
}

/** One corner-cutting pass: every segment gives its 1/4 and 3/4 points. */
function chaikin(points: readonly number[]): readonly number[] {
  if (points.length < 4) return points;
  const smoothed = [points[0]!, points[1]!];
  for (let index = 0; index < points.length - 2; index += 2) {
    const x1 = points[index]!;
    const y1 = points[index + 1]!;
    const x2 = points[index + 2]!;
    const y2 = points[index + 3]!;
    smoothed.push(
      0.75 * x1 + 0.25 * x2,
      0.75 * y1 + 0.25 * y2,
      0.25 * x1 + 0.75 * x2,
      0.25 * y1 + 0.75 * y2,
    );
  }
  smoothed.push(points.at(-2)!, points.at(-1)!);
  return smoothed;
}

function filterClosePoints(points: readonly number[]): number[] {
  const kept = [points[0]!, points[1]!];
  for (let index = 2; index < points.length; index += 2) {
    const point: PdfPoint = [points[index]!, points[index + 1]!];
    if (apart([kept.at(-2)!, kept.at(-1)!], point) >= MIN_POINT_DISTANCE) {
      kept.push(...point);
    }
  }
  return kept;
}

/** Zotero's own Euclidean distance, kept op for op so a filter decision at
 * the one-point threshold is the one Zotero makes. */
function apart(a: PdfPoint, b: PdfPoint): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return Math.sqrt(dx * dx + dy * dy);
}
