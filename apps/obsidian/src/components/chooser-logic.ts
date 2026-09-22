// What a Chooser shows and what a tick leaves behind, decided as data rather
// than in a component: the rows a query leaves standing, and the selection a
// toggled row produces.
//
// @see apps/obsidian/policies/ui-seams.md
// @see apps/obsidian/docs/adr/0044-menus-and-popovers-are-obsidians-own-primitives.md

/** A row's value and the text a query matches it by. */
export interface ChooserRow {
  value: string;
  label: string;
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
