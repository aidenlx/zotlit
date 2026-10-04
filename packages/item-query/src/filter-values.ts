import { compareStrings } from "./collation";

/**
 * A value of a Filter Expression. A Zotero field value is a string whether
 * SQLite stores it as text or as a number.
 */
export type FilterValue =
  | null
  | boolean
  | number
  | string
  | readonly FilterValue[];

/** The type of a non-null {@link FilterValue}, or `"null"`. */
export type FilterValueType = "null" | "boolean" | "number" | "string" | "list";

export function typeOf(value: FilterValue): FilterValueType {
  if (value === null) return "null";
  if (isList(value)) return "list";
  return typeof value as "boolean" | "number" | "string";
}

export function isList(value: FilterValue): value is readonly FilterValue[] {
  return Array.isArray(value);
}

/**
 * Whether a value selects the Item: null, `false`, zero, the empty string, and
 * the empty list are falsy.
 */
export function truthy(value: FilterValue): boolean {
  if (value === null) return false;
  if (isList(value)) return value.length > 0;
  return Boolean(value);
}

/**
 * Equality of `==`, `!=`, and list membership: exact, with no coercion between
 * types. Null equals only null. Strings compare by code unit: case-sensitive,
 * no Unicode normalization. Lists compare position by position.
 */
export function equals(a: FilterValue, b: FilterValue): boolean {
  if (isList(a)) {
    return (
      isList(b) &&
      a.length === b.length &&
      a.every((element, index) => equals(element, b[index]!))
    );
  }
  return a === b;
}

/**
 * The order of two values for `<`, `<=`, `>`, and `>=`: negative, zero, or
 * positive. Null when either value is null, when the types differ, or when the
 * type has no order. Strings use the Item Query string order.
 */
export function order(a: FilterValue, b: FilterValue): number | null {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "string" && typeof b === "string") {
    return compareStrings(a, b);
  }
  return null;
}

/** The text of a value for `toString()` and for `+` with a string. */
export function toText(value: FilterValue): string {
  if (value === null) return "null";
  if (isList(value)) return value.map(toText).join(", ");
  return String(value);
}
