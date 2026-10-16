// The icon that names the kind of value a Property holds, as Obsidian marks
// each property type: text, number, date, list, checkbox, formula. A column
// header of the Table shows it before the Property's label.
import { planPath } from "@zotlit/item-query";

import { DATASETS } from "./datasets";
import type { QueryFileDataset } from "./query-file";
import type { PropertyEntry } from "./view-properties";

/** The icon of `property` in a view of `dataset`. */
export function propertyIcon(
  dataset: QueryFileDataset,
  property: Pick<PropertyEntry, "path" | "kind">,
): string {
  if (property.kind === "formula") return "square-function";
  if (property.kind === "literatureNote") return "file";
  const { engine, sort } = DATASETS[dataset];
  const kind = sort.find(([path]) => path === property.path)?.[2];
  if (kind === "date") return "calendar";
  if (kind === "number") return "binary";
  const planned = planPath(property.path, engine.resolvePath);
  const shape = "shape" in planned ? planned.shape : undefined;
  if (shape?.kind === "list") return "list";
  if (shape?.kind === "scalar" && shape.type === "number") return "binary";
  if (shape?.kind === "scalar" && shape.type === "boolean")
    return "check-square";
  return "text";
}
