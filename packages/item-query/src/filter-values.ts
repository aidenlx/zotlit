import { compareStrings } from "./collation";
import { compareDates, dateText, durationsEqual } from "./filter-dates";
import type { DateComparison, DateValue, DurationValue } from "./filter-dates";
import type { QueryClock } from "./query-clock";

/**
 * A value of a Filter Expression. A Zotero field value is a string whether
 * SQLite stores it as text or as a number.
 */
export type FilterValue =
  | null
  | boolean
  | number
  | string
  | readonly FilterValue[]
  | DateValue
  | DurationValue
  | RegexpValue;

/**
 * A regular expression, from a `/pattern/flags` literal. A filter-only
 * value: it never enters a Query Row.
 */
export interface RegexpValue {
  readonly type: "regexp";
  readonly regexp: RegExp;
}

/** The type of a non-null {@link FilterValue}, or `"null"`. */
export type FilterValueType =
  | "null"
  | "boolean"
  | "number"
  | "string"
  | "list"
  | "date"
  | "duration"
  | "regexp";

export function typeOf(value: FilterValue): FilterValueType {
  if (value === null) return "null";
  if (isList(value)) return "list";
  if (typeof value === "object") return value.type;
  return typeof value as "boolean" | "number" | "string";
}

export function isDate(value: FilterValue): value is DateValue {
  return typeOf(value) === "date";
}

export function isDuration(value: FilterValue): value is DurationValue {
  return typeOf(value) === "duration";
}

export function isList(value: FilterValue): value is readonly FilterValue[] {
  return Array.isArray(value);
}

export function isRegexp(value: FilterValue): value is RegexpValue {
  return typeOf(value) === "regexp";
}

/**
 * Whether a value selects the Item: null, `false`, zero, the empty string, the
 * empty list, and a zero duration are falsy. A date is truthy.
 */
export function truthy(value: FilterValue): boolean {
  if (value === null) return false;
  if (isList(value)) return value.length > 0;
  if (isDuration(value)) return !value.duration.blank;
  return Boolean(value);
}

/**
 * Equality of `==`, `!=`, and list membership: exact, with no coercion between
 * types. Null equals only null. Strings compare by code unit: case-sensitive,
 * no Unicode normalization. Lists compare position by position. Two dates are
 * equal when they share a calendar day (see {@link compareDates}); two
 * durations when every unit holds the same count; two regexps when their
 * source and flags are equal.
 */
export function equals(
  a: FilterValue,
  b: FilterValue,
  clock: QueryClock,
): boolean {
  if (isList(a)) {
    return (
      isList(b) &&
      a.length === b.length &&
      a.every((element, index) => equals(element, b[index]!, clock))
    );
  }
  if (isDate(a)) return isDate(b) && compareDates("==", [a, b], clock);
  if (isDuration(a)) return isDuration(b) && durationsEqual(a, b);
  if (isRegexp(a)) {
    return (
      isRegexp(b) &&
      a.regexp.source === b.regexp.source &&
      a.regexp.flags === b.regexp.flags
    );
  }
  return a === b;
}

/**
 * The result of `<`, `<=`, `>`, and `>=`. Null when either value is null,
 * when the types differ, or when the type has no order. Strings use the Item
 * Query string order; dates compare as {@link compareDates} says.
 */
export function compare(
  operator: Exclude<DateComparison, "==" | "!=">,
  [a, b]: readonly [FilterValue, FilterValue],
  clock: QueryClock,
): boolean | null {
  if (isDate(a) && isDate(b)) return compareDates(operator, [a, b], clock);
  const ordered = order(a, b);
  if (ordered === null) return null;
  if (operator === "<") return ordered < 0;
  if (operator === "<=") return ordered <= 0;
  return operator === ">" ? ordered > 0 : ordered >= 0;
}

function order(a: FilterValue, b: FilterValue): number | null {
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
  if (isDate(value)) return dateText(value);
  if (isDuration(value)) return value.duration.toString();
  if (isRegexp(value)) return `/${value.regexp.source}/${value.regexp.flags}`;
  return String(value);
}
