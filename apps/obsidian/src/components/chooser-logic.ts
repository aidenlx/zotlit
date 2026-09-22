// What a Chooser shows, where its highlight lands, and what a tick leaves
// behind, decided as data rather than in a component: the rows a query leaves
// standing, the row a navigation key highlights, and the selection a toggled
// row produces.
//
// @see apps/obsidian/policies/ui-seams.md
// @see apps/obsidian/docs/adr/0044-menus-and-popovers-are-obsidians-own-primitives.md

/** A row's value and the text a query matches it by. */
export interface ChooserRow {
  value: string;
  label: string;
  /**
   * Whether the row refuses a tick. It travels with the row rather than only
   * with the rendered item, so a key reads the same flag the row draws.
   */
  disabled?: boolean;
}

/**
 * The shape Obsidian's `prepareFuzzySearch(query)` returns: a result for a
 * match, `null` for a miss. The Chooser hands one in rather than reaching for
 * the search helper itself, so the decision below stays this module's own.
 */
export type ChooserMatcher = (text: string) => { score: number } | null;

/**
 * The rows a query leaves standing, in the order they arrived. `null` is the
 * empty query, which every row survives.
 *
 * A match is read as "matched or not"; its score is discarded and never
 * reorders the list, the way Obsidian's own lists keep the order they were
 * given.
 *
 * The row stays a type parameter because a caller's row carries more than a
 * value and a label — the tag rows hold a hit count — and the survivors are
 * handed back for that caller to render.
 */
export function visibleRows<Row extends ChooserRow>(
  rows: readonly Row[],
  matcher: ChooserMatcher | null,
): Row[] {
  if (!matcher) return [...rows];
  return rows.filter((row) => matcher(row.label) !== null);
}

/**
 * The selection after one row is ticked: the value joins at the end, or leaves
 * the collection when it is already there. The rest keep their order, so a
 * consumer reading the selection back never sees it reshuffled by a tick.
 *
 * The Annotation View's tag filter toggles through here too, so one rule
 * decides a tick wherever it happens.
 */
export function toggledValues(
  values: readonly string[],
  value: string,
): string[] {
  return values.includes(value)
    ? values.filter((current) => current !== value)
    : [...values, value];
}

/**
 * A step the highlight takes when a navigation key fires: one row either way,
 * a page either way, or an end of the list.
 */
export type ChooserMove =
  | "previous"
  | "next"
  | "page-up"
  | "page-down"
  | "first"
  | "last";

/** The list the highlight moves over. */
export interface ChooserExtent {
  /** How many rows the list is showing. */
  count: number;
  /** How many rows a page step covers; at least one row. */
  pageSize: number;
}

/**
 * The index the highlight settles on, given where it stands and which key
 * moved it. `-1` is "no row", which an empty list always answers.
 *
 * A single step wraps: from the last row Down reaches the first, and from the
 * first row Up reaches the last, so holding an arrow key never dead-ends. A
 * page step clamps instead, because a page is a distance rather than a step —
 * wrapping it would jump the highlight across the list on a key the user
 * pressed to travel within it.
 */
export function movedHighlight(
  index: number,
  move: ChooserMove,
  { count, pageSize }: ChooserExtent,
): number {
  const at = clampedHighlight(index, count);
  if (at < 0) return -1;
  const last = count - 1;
  const page = Math.max(1, pageSize);
  switch (move) {
    case "previous":
      return at === 0 ? last : at - 1;
    case "next":
      return at === last ? 0 : at + 1;
    case "page-up":
      return Math.max(0, at - page);
    case "page-down":
      return Math.min(last, at + page);
    case "first":
      return 0;
    case "last":
      return last;
  }
}

/**
 * The index a held highlight still points at once the list under it changed:
 * the row itself while it is in range, the last row when the list shrank past
 * it, the first row when nothing was highlighted yet, and `-1` for an empty
 * list.
 */
export function clampedHighlight(index: number, count: number): number {
  if (count <= 0) return -1;
  if (index < 0) return 0;
  return Math.min(index, count - 1);
}

/**
 * Where the highlight lands once the rows under it changed: on the row it was
 * standing on, whenever that row is still there, and on the first row
 * otherwise.
 *
 * Both halves are gestures the user makes. Ticking a row rebuilds the list
 * around the same rows, and the highlight staying put is what lets several
 * rows be ticked in one visit. Typing another letter takes rows away, and an
 * index kept across that would point at whatever slid into its place.
 */
export function rehomedHighlight(
  value: string | null,
  rows: readonly ChooserRow[],
): number {
  if (rows.length === 0) return -1;
  const at = value === null ? -1 : rows.findIndex((row) => row.value === value);
  return at < 0 ? 0 : at;
}
