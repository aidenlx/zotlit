// What a Chooser shows, where its highlight lands, and what a tick leaves
// behind, decided as data rather than in a component: the groups and rows a
// query leaves standing, the row a navigation key highlights, what activating
// a row comes to, and the selection a toggled row produces.
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
  /**
   * What the row runs in place of ticking. A row carrying one is an action
   * row: it stands in the same list as the entries, reports no selected state,
   * and the highlight reaches it with the same keys.
   *
   * The `close` it is handed is the only way an action leaves the popup shut;
   * an action that never calls it leaves the popup standing.
   */
  action?: (close: () => void) => void;
}

/** A run of rows drawn together, under a heading when the caller names one. */
export interface ChooserGroup<Row extends ChooserRow> {
  /** The heading over the group. A group without one draws no heading. */
  label?: string;
  items: readonly Row[];
}

/**
 * The shape Obsidian's `prepareFuzzySearch(query)` returns: a result for a
 * match, `null` for a miss. The Chooser hands one in rather than reaching for
 * the search helper itself, so the decision below stays this module's own.
 */
export type ChooserMatcher = (text: string) => { score: number } | null;

/** A group once the query has been through it, with its survivors. */
export interface ChooserSection<Row extends ChooserRow> {
  label?: string;
  /**
   * Where the group sits in the caller's list. A query that empties a group
   * drops it, so a section's place among the survivors shifts under it; this
   * is the identity that holds still, and what a renderer keys a section by.
   */
  groupIndex: number;
  rows: Row[];
}

/** How the rows are drawn, and the order the highlight walks them in. */
export interface ChooserLayout<Row extends ChooserRow> {
  /** The groups that still have a row, in the order they were given. */
  sections: ChooserSection<Row>[];
  /** Every surviving row, flattened: what a navigation key moves over. */
  rows: Row[];
  /**
   * Whether the query left no entry standing. Action rows are exempt from the
   * query, so a layout can still hold rows while this is true, and the empty
   * message belongs beside them rather than in their place.
   */
  empty: boolean;
}

/**
 * The groups a query leaves standing, and the flat row sequence underneath
 * them. A group the query empties is dropped whole — no heading and no
 * separator draw for rows that are not there. `null` is the empty query, which
 * every row survives.
 *
 * A match is read as "matched or not"; its score is discarded and never
 * reorders the list, the way Obsidian's own lists keep the order they were
 * given.
 *
 * An action row is exempt from the query. What it runs is not part of the
 * vocabulary being searched, so typing a fragment of an entry must not carry
 * "Clear selected tags" away, and typing a fragment of the action's own label
 * must not read as a search hit that leaves the action standing alone. Entries
 * alone decide whether the query came out empty, which is why {@link
 * ChooserLayout.empty} is reported rather than read off the row count.
 *
 * The row stays a type parameter because a caller's row carries more than a
 * value and a label — the tag rows hold a hit count — and the survivors are
 * handed back for that caller to render.
 */
export function chooserLayout<Row extends ChooserRow>(
  groups: readonly ChooserGroup<Row>[],
  matcher: ChooserMatcher | null,
): ChooserLayout<Row> {
  const sections: ChooserSection<Row>[] = [];
  for (const [groupIndex, group] of groups.entries()) {
    const rows = group.items.filter(
      (row) =>
        row.action !== undefined ||
        matcher === null ||
        matcher(row.label) !== null,
    );
    if (rows.length > 0)
      sections.push({ label: group.label, groupIndex, rows });
  }
  const rows = sections.flatMap((section) => section.rows);
  return {
    sections,
    rows,
    empty: rows.every((row) => row.action !== undefined),
  };
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

/** What activating a row comes to. */
export type ChooserActivation =
  | { kind: "ignored" }
  | { kind: "action"; run: (close: () => void) => void }
  | { kind: "select"; values: string[] };

/**
 * What activating a row does: run the action it carries, or hand back the
 * selection a tick leaves behind. A row that is absent or disabled answers
 * "ignored", so a key on an empty list and a key on a row that refuses a tick
 * come to the same nothing.
 *
 * One rule for both the highlighted row under Enter and the row under a click,
 * which is what keeps an action row reachable by exactly the keys an entry is.
 */
export function activatedRow(
  row: ChooserRow | undefined,
  selected: readonly string[],
): ChooserActivation {
  if (!row || row.disabled) return { kind: "ignored" };
  if (row.action) return { kind: "action", run: row.action };
  return { kind: "select", values: toggledValues(selected, row.value) };
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
  count: number;
  /** How many rows a page step covers; at least one row. */
  pageSize: number;
}

/**
 * The index the highlight settles on, given where it stands and which key
 * moved it. `-1` is "no row", which an empty list always answers, and where
 * the highlight rests until a key or the pointer names a row: from there a
 * step down or a jump to the end lands on the first row, and a step up or a
 * jump to the start of the list on the last.
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
  if (count <= 0) return -1;
  const at = clampedHighlight(index, count);
  const last = count - 1;
  if (at < 0) return move === "previous" || move === "last" ? last : 0;
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
 * it, and `-1` for an empty list or for no row highlighted yet.
 */
export function clampedHighlight(index: number, count: number): number {
  if (count <= 0 || index < 0) return -1;
  return Math.min(index, count - 1);
}

/**
 * Where the highlight lands once the rows under it changed: on the row it was
 * standing on, whenever that row is still there; on the first row when that
 * row is gone; and on no row when none was highlighted to begin with.
 *
 * Each is a gesture the user makes. Ticking a row rebuilds the list around
 * the same rows, and the highlight staying put is what lets several rows be
 * ticked in one visit. Typing another letter takes rows away, and an index
 * kept across that would point at whatever slid into its place. Opening the
 * popup publishes rows under a highlight that stands on nothing, and a pointer
 * user sees no row darkened until the pointer or a key names one.
 */
export function rehomedHighlight(
  value: string | null,
  rows: readonly ChooserRow[],
): number {
  if (rows.length === 0 || value === null) return -1;
  const at = rows.findIndex((row) => row.value === value);
  return at < 0 ? 0 : at;
}
