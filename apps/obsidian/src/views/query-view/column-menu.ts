// What a Table column's menu offers, as the Bases column menu lays it out:
// hide the column or group by it, then the moves and the reset a drag and a
// double click make, spelled out, then the sorts, then the property's page.
// The header (`table-header.tsx`) fills an Obsidian `Menu` from these
// entries, a separator between each group.
import type { QueryFileSort } from "./query-file";
import type { QueryViewCapabilities } from "./view";
import type { PropertyKind } from "./view-properties";

/** What one entry of a column's menu does. */
export type ColumnMenuAction =
  | "hide"
  | "group"
  | "move-left"
  | "move-right"
  | "reset-width"
  | "sort-asc"
  | "sort-desc"
  | "clear-sort"
  | "edit-property"
  | "edit-formula";

export interface ColumnMenuEntry {
  readonly action: ColumnMenuAction;
  /** Shown, with nothing to do there. */
  readonly disabled?: boolean;
  /** The column's state now: its sort direction, or the view's grouping by it. */
  readonly checked?: boolean;
}

/** What the menu reads of a column and its view. */
export interface ColumnMenuInput {
  readonly path: string;
  readonly kind: PropertyKind;
  /** The column's place among the visible columns. */
  readonly at: number;
  /** How many visible columns the header shows. */
  readonly count: number;
  /** Whether the header lays out right to left, which swaps left and right. */
  readonly rtl: boolean;
  /** Whether the researcher set the column's width. */
  readonly sized: boolean;
  /** What the host lets the menu change; an entry it cannot save leaves. */
  readonly can: Pick<
    QueryViewCapabilities,
    "properties" | "group" | "columnWidth" | "propertyPages"
  >;
  /** Whether ZotLit Query sorts by the column now. */
  readonly sortable: boolean;
  /** The view's sort. */
  readonly sort: readonly QueryFileSort[];
  /** The view's grouping. */
  readonly groupBy: QueryFileSort | undefined;
  /**
   * The group path the dataset groups the column by, as `tags[]` for the
   * column `tags`; `null` where it groups by no such path.
   */
  readonly grouping: string | null;
}

/**
 * The menu of a column, one array per group. An entry with nothing to do
 * there shows disabled, as the moves at an edge do; one the host cannot
 * save, or that the column has no use for, leaves, and so does a group
 * left empty.
 */
export function columnMenuEntries(input: ColumnMenuInput): ColumnMenuEntry[][] {
  const { can, at, count, rtl } = input;
  const atStart = at <= 0;
  const atEnd = at < 0 || at >= count - 1;
  const sorted = input.sort.find((sort) => sort.property === input.path);
  const groups: (ColumnMenuEntry | false)[][] = [
    [
      can.properties && { action: "hide" },
      can.group &&
        input.grouping !== null && {
          action: "group",
          checked: input.groupBy?.property === input.grouping,
        },
    ],
    [
      // Left and right as the researcher sees them, in either direction.
      { action: "move-left", disabled: rtl ? atEnd : atStart },
      { action: "move-right", disabled: rtl ? atStart : atEnd },
      can.columnWidth && { action: "reset-width", disabled: !input.sized },
    ],
    [
      {
        action: "sort-asc",
        disabled: !input.sortable,
        checked: sorted?.direction === "ASC",
      },
      {
        action: "sort-desc",
        disabled: !input.sortable,
        checked: sorted?.direction === "DESC",
      },
      sorted !== undefined && { action: "clear-sort" },
    ],
    [
      can.propertyPages && {
        action: input.kind === "formula" ? "edit-formula" : "edit-property",
      },
    ],
  ];
  return groups
    .map((group) => group.filter((entry) => entry !== false))
    .filter((group) => group.length > 0);
}
