// The properties a Query View can show: the Projection Paths of its Query
// Dataset that give one cell each, read from the same descriptor ZotLit Query
// plans with.
import { cellProperties } from "@zotlit/item-query";

import { DATASETS } from "./datasets";
import { QUERY_FILE_DATASETS } from "./query-file";
import type { QueryFileDataset, QueryFileView } from "./query-file";

const cache = new Map<QueryFileDataset, readonly string[]>();

/**
 * The properties of a dataset, in the order ZotLit Query lists them: the
 * paths that give one cell each. An Annotation's position is left out; its
 * numbers mean nothing in a table.
 */
export function datasetProperties(
  dataset: QueryFileDataset,
): readonly string[] {
  let properties = cache.get(dataset);
  if (!properties) {
    properties = cellProperties(DATASETS[dataset].engine).filter(
      (path) => path !== "position" && !path.startsWith("position."),
    );
    cache.set(dataset, properties);
  }
  return properties;
}

/**
 * Whether a view of `dataset` can show `property`: the dataset lists it, or
 * no dataset does, as for a path the researcher typed, which ZotLit Query
 * then reads or names as wrong.
 */
export function fitsDataset(
  property: string,
  dataset: QueryFileDataset,
): boolean {
  return (
    datasetProperties(dataset).includes(property) ||
    !QUERY_FILE_DATASETS.some((other) =>
      datasetProperties(other).includes(property),
    )
  );
}

/**
 * The rows of the Properties popover: the visible properties first, in their
 * order, then the other properties of the record itself. While the user
 * searches, the properties of the parent records come too.
 */
export function propertyChoices(
  properties: readonly string[],
  order: readonly string[],
  query: string,
): string[] {
  const shown = new Set(order);
  const rest = properties.filter(
    (property) =>
      !shown.has(property) && (query !== "" || !property.includes(".")),
  );
  return [...order, ...rest];
}

/**
 * The visible properties of a view, in its order, without those its dataset
 * lacks. Where `fallback` asks for them, a view that shows none gives the
 * properties ZotLit Query projects by default, so a copy or an export still
 * has columns.
 */
export function visibleProperties(
  view: Pick<QueryFileView, "order" | "from">,
  { fallback = false }: { fallback?: boolean } = {},
): readonly string[] {
  const dataset = view.from ?? "annotations";
  const shown = (view.order ?? []).filter((property) =>
    fitsDataset(property, dataset),
  );
  if (shown.length > 0) return shown;
  if (!fallback) return [];
  const properties = datasetProperties(dataset);
  return DATASETS[dataset].engine.defaultFields.filter((field) =>
    properties.includes(field),
  );
}
