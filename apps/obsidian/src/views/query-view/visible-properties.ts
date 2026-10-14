// The properties a Query View can show: the Projection Paths of its Query
// Dataset that give one cell each, read from the same descriptor ZotLit Query
// plans with.
import { cellProperties } from "@zotlit/item-query";

import { DATASETS } from "./datasets";
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
 * The visible properties of a view, in its order. Where `fallback` asks for
 * them, a view that names none gives the properties ZotLit Query projects by
 * default, so a copy or an export still has columns.
 */
export function visibleProperties(
  view: Pick<QueryFileView, "order" | "from">,
  { fallback = false }: { fallback?: boolean } = {},
): readonly string[] {
  if (view.order && view.order.length > 0) return view.order;
  if (!fallback) return [];
  const dataset = view.from ?? "annotations";
  const properties = datasetProperties(dataset);
  return DATASETS[dataset].engine.defaultFields.filter((field) =>
    properties.includes(field),
  );
}
