// How a Query View names a property and writes its value as text. The Table,
// the List and Cards layouts, their search, and "Copy to clipboard" and
// "Export CSV…" all read them from here, so each shows and finds the same text.
import { FIELD_LABELS } from "@zotlit/zotero-types/field-labels";

import * as m from "@/lib/i18n/generated/messages";
import { runtime } from "@/lib/i18n/generated/runtime";
import type { QueryViewValue } from "@/services/item-query/query-view";
import { itemTypeLabel } from "@/services/profile-selection/describe";

import { DATASETS } from "./datasets";
import { displayName } from "./query-file";
import type { QueryFile } from "./query-file";

/**
 * The name of a property, as a column header and a notice show it: Zotero's
 * label for an Item field, else the label the Query Datasets give it in Sort
 * and Group, else, for a field of the Item or of the Attachment, that
 * field's name under its parent's. A path with none of these shows as it is.
 */
export function columnLabel(property: string): string {
  return labelOf(property) ?? property;
}

function labelOf(property: string): string | undefined {
  const locale = runtime.getLocale() === "zh-CN" ? "zh-CN" : "en-US";
  const label = FIELD_LABELS[locale][property] ?? datasetLabel(property);
  if (label) return label;
  for (const [prefix, parent, of] of PARENTS) {
    if (!property.startsWith(prefix)) continue;
    const field = labelOf(property.slice(prefix.length));
    if (field === undefined) return undefined;
    // "Item Type" names the field under its parent's name already.
    const rest = field.startsWith(parent())
      ? field.slice(parent().length)
      : null;
    return of({
      property: inSentence(
        rest !== null && !/^[a-z]/i.test(rest) ? rest.trim() : field,
      ),
    });
  }
  return undefined;
}

/** The parents a dataset reads fields of, by the prefix of their paths. */
const PARENTS = [
  ["item.", m.query_view_property_item, m.query_view_property_of_item],
  [
    "attachment.",
    m.query_view_property_attachment,
    m.query_view_property_of_attachment,
  ],
] as const;

/** The label the Query Datasets give a path in Sort and Group, by path. */
let datasetLabels: ReadonlyMap<string, () => string> | null = null;

function datasetLabel(property: string): string | undefined {
  datasetLabels ??= new Map(
    Object.values(DATASETS).flatMap((spec) => [
      ...spec.sort.map(([path, label]) => [path, label] as const),
      // A grouping by a list path names one value of the list.
      ...spec.group.map(
        ({ path, label }) => [path.replace(/\[\]$/, ""), label] as const,
      ),
    ]),
  );
  return datasetLabels.get(property)?.();
}

/**
 * A label inside a sentence: each word in lower case but an acronym, so
 * "Date Added" reads "date added" and "Archive ID" reads "archive ID".
 */
function inSentence(label: string): string {
  return label
    .split(" ")
    .map((word) => (/^[A-Z0-9]{2,}$/.test(word) ? word : word.toLowerCase()))
    .join(" ");
}

/**
 * The name a view shows for `property`: its Display Name in `file`, else its
 * column header.
 */
export function propertyLabel(
  file: QueryFile | null,
  property: string,
): string {
  return (file && displayName(file, property)) ?? columnLabel(property);
}

/** The code and message of a Formula cell that holds an Error Value. */
export interface ErrorCell {
  readonly kind: "error";
  readonly code: string;
  readonly message: string;
}

/** The Error Value that `value` holds, as a cell shows it; else null. */
export function errorCell(value: QueryViewValue | undefined): ErrorCell | null {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return null;
  const record = value as Readonly<Record<string, QueryViewValue>>;
  return record.kind === "error" &&
    typeof record.code === "string" &&
    typeof record.message === "string"
    ? { kind: "error", code: record.code, message: record.message }
    : null;
}

/** One value as the text of a cell. */
export function cellText(
  property: string,
  value: QueryViewValue | undefined,
): string {
  if (property === "itemType" && typeof value === "string")
    return itemTypeLabel(value);
  return cell(value);
}

/** One value as the text of one cell. */
export function cell(value: QueryViewValue | undefined): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (Array.isArray(value))
    return value
      .map((entry: QueryViewValue) => cell(entry))
      .filter((text) => text !== "")
      .join(", ");
  // An Error Value reads as the Formula's toString() gives it.
  const error = errorCell(value);
  if (error) return `Error: ${error.message}`;
  const record = value as Readonly<Record<string, QueryViewValue>>;
  // A date reads as Zotero shows it: its text, else the part of its stored
  // "2011-00-00 2011" form after the first space.
  if (typeof record.raw === "string") {
    if (typeof record.text === "string" && record.text !== "")
      return record.text;
    const space = record.raw.indexOf(" ");
    return space === -1 ? record.raw : record.raw.slice(space + 1);
  }
  // A tag or a Collection reads as its name, a creator as their name.
  for (const key of ["name", "fullName", "title"])
    if (typeof record[key] === "string" && record[key] !== "")
      return record[key];
  const names = [record.firstName, record.lastName].filter(
    (part): part is string => typeof part === "string" && part !== "",
  );
  return names.length > 0 ? names.join(" ") : JSON.stringify(value);
}
