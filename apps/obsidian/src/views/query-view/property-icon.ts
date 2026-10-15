// The icon that names the kind of value a Property holds, as Obsidian marks
// each property type: text, number, date, list, checkbox, formula. A column
// header of the Table shows it before the Property's label.
import type { QueryDataset } from "@zotlit/item-query";

import { DATASETS } from "./datasets";
import type { QueryFileDataset } from "./query-file";
import type { PropertyEntry } from "./view-properties";

type ValueShape = NonNullable<ReturnType<QueryDataset["definition"]>>["shape"];

/** The shape of the value at `path`, or `undefined` where the dataset has none. */
function shapeAt(engine: QueryDataset, path: string): ValueShape | undefined {
  let shape: ValueShape | undefined;
  for (const [at, segment] of path.split(".").entries()) {
    const list = segment.endsWith("[]");
    const name = list ? segment.slice(0, -2) : segment;
    if (at === 0) shape = engine.definition(name)?.shape;
    else if (shape?.kind === "object") shape = shape.keys[name];
    else if (shape?.kind === "record")
      shape = shape.vocabulary().field(name)?.shape;
    else return undefined;
    if (list && shape?.kind === "list") shape = shape.element;
  }
  return shape;
}

/** The icon of `property` in a view of `dataset`. */
export function propertyIcon(
  dataset: QueryFileDataset,
  property: Pick<PropertyEntry, "path" | "formula">,
): string {
  if (property.formula !== null) return "square-function";
  const { engine, sort } = DATASETS[dataset];
  const kind = sort.find(([path]) => path === property.path)?.[2];
  if (kind === "date") return "calendar";
  if (kind === "number") return "binary";
  const shape = shapeAt(engine, property.path);
  if (shape?.kind === "list") return "list";
  if (shape?.kind === "scalar" && shape.type === "number") return "binary";
  if (shape?.kind === "scalar" && shape.type === "boolean")
    return "check-square";
  return "text";
}
