// The icon that names the kind of value a Property holds, as Obsidian marks
// each property type: text, number, date, list, checkbox, formula. A column
// header of the Table shows it before the Property's label. A vault property
// takes the icon Obsidian gives its property type.
import { planPath } from "@zotlit/item-query";

import { DATASETS } from "./datasets";
import { LITERATURE_NOTE, vaultName } from "./query-file";
import type { QueryFileDataset } from "./query-file";
import type { VaultPropertyType } from "./table-notes";
import type { PropertyEntry } from "./view-properties";

/** The Lucide icon Obsidian draws for each property type. */
const VAULT_ICONS: Record<VaultPropertyType, string> = {
  text: "text",
  multitext: "list",
  number: "binary",
  checkbox: "check-square",
  date: "calendar",
  datetime: "clock",
  tags: "tags",
  aliases: "forward",
};

/**
 * The icon of `property` in a view of `dataset`. `vaultType` gives the type
 * of a vault property by its name; without it, a vault property is text.
 */
export function propertyIcon(
  dataset: QueryFileDataset,
  property: Pick<PropertyEntry, "path" | "kind">,
  vaultType?: (name: string) => VaultPropertyType,
): string {
  if (property.kind === "formula") return "square-function";
  if (property.path === LITERATURE_NOTE) return "file";
  if (property.kind === "vault") {
    const name = vaultName(property.path);
    return VAULT_ICONS[name !== null && vaultType ? vaultType(name) : "text"];
  }
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
