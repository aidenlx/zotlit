// The properties a Query View's Sort and Group controls offer, by the names a
// researcher knows them by. Sort offers only Sortable Fields of ZotLit Query;
// Group offers the group paths the layouts of the view's dataset can gather
// rows by.
import * as m from "@/lib/i18n/generated/messages";

import { datasetSpec } from "./datasets";
import type { QueryFileDataset, QueryFileDirection } from "./query-file";

/** How a property's values order, which names its two directions. */
export type PropertyKind = "text" | "date" | "number";

export interface PropertyOption {
  /** The Projection Path, as the file names it. */
  readonly path: string;
  readonly label: string;
  readonly kind: PropertyKind;
}

/**
 * The label of a property, as a view's Property entries give it; `undefined`
 * where the caller has no view, which leaves the labels of the dataset.
 */
export type OptionLabel = ((path: string) => string) | undefined;

/** The properties a view of `dataset` can sort by, in the order Sort lists them. */
export function sortOptions(
  dataset: QueryFileDataset | undefined,
  labelOf?: OptionLabel,
): PropertyOption[] {
  const { engine, sort } = datasetSpec(dataset);
  const sortable = new Set(engine.sortableFields);
  return sort
    .filter(([path]) => sortable.has(path))
    .map(([path, label, kind]) => ({
      path,
      label: labelOf?.(path) ?? label(),
      kind,
    }));
}

/** The properties a view of `dataset` can group by, in the order Group lists them. */
export function groupOptions(
  dataset: QueryFileDataset | undefined,
  labelOf?: OptionLabel,
): PropertyOption[] {
  return datasetSpec(dataset).group.map(({ path, label }) => ({
    path,
    // A grouping by a list path names one value of the list.
    label: labelOf?.(path.replace(/\[\]$/, "")) ?? label(),
    kind: "text",
  }));
}

/** The name of one direction of a property, as Bases names it. */
export function directionLabel(
  kind: PropertyKind,
  direction: QueryFileDirection,
): string {
  const ascending = direction === "ASC";
  switch (kind) {
    case "date":
      return ascending
        ? m.query_view_sort_old_new()
        : m.query_view_sort_new_old();
    case "number":
      return ascending ? m.query_view_sort_01() : m.query_view_sort_10();
    case "text":
      return ascending ? m.query_view_sort_az() : m.query_view_sort_za();
    default:
      kind satisfies never;
      return direction;
  }
}
