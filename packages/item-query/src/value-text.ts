// How the value of one Projection Path reads as text, from its JSON form. The
// Query View's layouts, search, copy and "Export CSV…", and the CSV and TSV
// exports of `zotlit:query`, all read it from here, so each writes the same
// text for the same value.
import { errorValueText } from "./filter-values";

/** A value of one Projection Path as JSON: a date is its ISO text. */
export type ProjectionJson =
  | null
  | string
  | number
  | boolean
  | readonly ProjectionJson[]
  | { readonly [key: string]: ProjectionJson };

/** The code and message of a Formula cell that holds an Error Value. */
export interface ErrorCell {
  readonly kind: "error";
  readonly code: string;
  readonly message: string;
}

/** The Error Value that `value` holds, as a cell shows it; else null. */
export function errorCell(value: ProjectionJson | undefined): ErrorCell | null {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return null;
  const record = value as Readonly<Record<string, ProjectionJson>>;
  return record.kind === "error" &&
    typeof record.code === "string" &&
    typeof record.message === "string"
    ? { kind: "error", code: record.code, message: record.message }
    : null;
}

/** One value as the text of one cell. */
export function valueText(value: ProjectionJson | undefined): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (Array.isArray(value))
    return value
      .map((entry: ProjectionJson) => valueText(entry))
      .filter((text) => text !== "")
      .join(", ");
  // An Error Value reads as the Formula's toString() gives it.
  const error = errorCell(value);
  if (error) return errorValueText(error.message);
  const record = value as Readonly<Record<string, ProjectionJson>>;
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
