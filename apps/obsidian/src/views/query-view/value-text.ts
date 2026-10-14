// How a Query View names a property and writes its value as text. The Table,
// the List and Cards layouts, their search, and "Copy to clipboard" and
// "Export CSV…" all read them from here, so each shows and finds the same text.
import { FIELD_LABELS } from "@zotlit/zotero-types/field-labels";

import * as m from "@/lib/i18n/generated/messages";
import { runtime } from "@/lib/i18n/generated/runtime";
import type { QueryViewValue } from "@/services/item-query/query-view";
import { itemTypeLabel } from "@/services/profile-selection/describe";

import { displayName } from "./query-file";
import type { QueryFile } from "./query-file";

/** The header of a column: Zotero's label for an Item field, else the path. */
export function columnLabel(property: string): string {
  const locale = runtime.getLocale() === "zh-CN" ? "zh-CN" : "en-US";
  const label = FIELD_LABELS[locale][property];
  if (label) return label;
  switch (property) {
    case "itemType":
      return m.query_view_property_item_type();
    case "dateAdded":
      return m.query_view_property_date_added();
    case "dateModified":
      return m.query_view_property_date_modified();
    case "firstAuthor":
      return m.query_view_property_first_author();
    default:
      return property;
  }
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
