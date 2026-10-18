// The rows of one query as the Annotations Layout shows them: in the query's
// order, and, for a grouped view, gathered under one heading per group. A row
// with several values of a list path, such as two tags, stands in each of
// their groups.
import { compareStrings } from "@zotlit/item-query";

import type { QueryViewRow } from "@/services/item-query/query-view";
import type { LayoutRow } from "@/views/annot-view/layout";

import { datasetSpec, grouping } from "./datasets";
import type {
  QueryFileDataset,
  QueryFileGroupValue,
  QueryFileView,
} from "./query-file";

/** The group paths a view of `dataset` can gather its rows by. */
export function groupPaths(
  dataset: QueryFileDataset | undefined,
): readonly string[] {
  return datasetSpec(dataset).group.map(({ path }) => path);
}

/** One group of the rows, as the Manual group order lists it. */
export interface LayoutGroup {
  /** The value the file's `groupOrder` names the group by. */
  value: QueryFileGroupValue;
  label: string;
  /** The rows in the group. */
  count: number;
  /** Whether the group shows; a Manual group order hides what it does not list. */
  shown: boolean;
}

/** What the layout shows of one query's rows. */
export interface LayoutRows {
  rows: LayoutRow[];
  /** Every group the rows hold, the shown ones first; empty when ungrouped. */
  groups: LayoutGroup[];
  /** The rows shown, each once however many groups it stands in. */
  count: number;
}

/**
 * The rows the layout shows. Groups order by the name each one shows under,
 * as Bases orders them by value: A to Z, or Z to A for a descending grouping.
 * A Manual group order shows the groups it lists, in its order, and hides
 * the rest. The group of no value stands last. The rows inside a group keep
 * the query's order. A grouping the view's dataset does not offer leaves the
 * rows ungrouped.
 */
export function layoutRows(
  rows: readonly QueryViewRow[],
  {
    from,
    groupBy,
    groupOrder,
  }: Pick<QueryFileView, "from" | "groupBy" | "groupOrder">,
): LayoutRows {
  const base = (row: QueryViewRow): LayoutRow => ({
    annotationKey: row.indexedKey,
    attachmentKey: row.attachmentIndexedKey ?? row.indexedKey,
  });
  const by = groupBy && grouping(from, groupBy.property);
  if (!groupBy || !by)
    return { rows: rows.map(base), groups: [], count: rows.length };
  const groups = new Map<
    QueryFileGroupValue,
    { label: string; rows: LayoutRow[] }
  >();
  for (const row of rows)
    for (const { value, label } of by.place(row)) {
      const group = groups.get(value) ?? { label, rows: [] };
      group.rows.push({
        ...base(row),
        group: { key: value ?? "", label },
      });
      groups.set(value, group);
    }
  const sign = groupBy.direction === "DESC" ? -1 : 1;
  let order: QueryFileGroupValue[] = [...groups.keys()]
    .filter((value) => value !== null)
    .sort(
      (a, b) =>
        sign *
        // The string order of ZotLit Query, so groups order as its sort does.
        (compareStrings(groups.get(a)!.label, groups.get(b)!.label) ||
          compareStrings(a!, b!)),
    );
  if (groups.has(null)) order.push(null);
  let hidden: QueryFileGroupValue[] = [];
  if (groupOrder) {
    hidden = order.filter((value) => !groupOrder.includes(value));
    order = groupOrder.filter((value) => groups.has(value));
  }
  const shownRows = order.flatMap((value) => groups.get(value)!.rows);
  const summary = (value: QueryFileGroupValue, shown: boolean) => ({
    value,
    label: groups.get(value)!.label,
    count: groups.get(value)!.rows.length,
    shown,
  });
  return {
    rows: shownRows,
    groups: [
      ...order.map((value) => summary(value, true)),
      ...hidden.map((value) => summary(value, false)),
    ],
    count: new Set(shownRows.map((row) => row.annotationKey)).size,
  };
}
