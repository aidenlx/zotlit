// The arithmetic of the Table layout's column moves and column widths, as Bases does them.
import type { ColumnSizes } from "./query-file";

/**
 * The gap a dragged column drops into: `0` before the first column,
 * `widths.length` after the last. `offset` is the pointer's distance from
 * the start edge of the columns along the line, and `widths` the columns'
 * widths in their order. As in Bases, a column before the dragged one takes
 * the drop before it, and a column after the dragged one takes it after it.
 */
export function dropGap(
  widths: readonly number[],
  from: number,
  offset: number,
): number {
  let edge = 0;
  for (const [at, width] of widths.entries()) {
    if (offset < edge + (at <= from ? width : 0)) return at;
    edge += width;
  }
  return widths.length;
}

/** The place a column at `from` moves to when it drops into `gap`; `null` where it stays. */
export function gapMove(from: number, gap: number): number | null {
  const to = gap > from ? gap - 1 : gap;
  return to === from ? null : to;
}

/**
 * A column's width while its edge is dragged: the width it started at, moved
 * by the pointer, in whole pixels and no narrower than `min`.
 */
export function resizedWidth({
  start,
  delta,
  direction,
  min,
}: {
  start: number;
  delta: number;
  direction: "ltr" | "rtl";
  min: number;
}): number {
  return Math.max(
    min,
    Math.round(start + (direction === "rtl" ? -delta : delta)),
  );
}

/**
 * The column widths with the width of `property` set, or removed for `null`,
 * which sets the column back to its auto width. No width left gives
 * `undefined`, which removes the key.
 */
export function withColumnWidth(
  sizes: ColumnSizes | undefined,
  property: string,
  width: number | null,
): ColumnSizes | undefined {
  const { [property]: _old, ...others } = sizes ?? {};
  // A width the view has keeps its place in the file.
  const next = width === null ? others : { ...sizes, [property]: width };
  return Object.keys(next).length > 0 ? next : undefined;
}
