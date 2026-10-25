// The LiquidJS date seam: LiquidJS's builtin `date` filter takes a JS `Date`,
// so the template's Temporal and ItemDate values convert here.

/**
 * Minimal structural view of a Zotero multipart date, duck-typed so this
 * package doesn't depend on `@zotlit/db`.
 *
 * @see `packages/db/src/lib/zt-date.ts` `ItemDate` for the full shape
 */
interface ItemDateLike {
  kind: "date" | "yearMonth" | "year" | "text";
  year: number | null;
  month: number | null;
  day: number | null;
  toString(): string;
}

const ITEM_DATE_KINDS: ReadonlySet<unknown> = new Set([
  "date",
  "yearMonth",
  "year",
  "text",
] satisfies ItemDateLike["kind"][]);

export function isItemDateLike(value: unknown): value is ItemDateLike {
  return (
    typeof value === "object" &&
    value !== null &&
    ITEM_DATE_KINDS.has((value as { kind?: unknown }).kind)
  );
}

/**
 * Normalizes Temporal / ItemDate-shaped values into a local-time JS `Date`
 * before delegating to the builtin `date` filter, which throws on Temporal
 * objects and would otherwise parse a stringified `PlainDate` as UTC via
 * `new Date(string)`.
 */
export function toLiquidDate(v: unknown): unknown {
  if (v instanceof Temporal.Instant) {
    return new Date(v.epochMilliseconds);
  }
  if (v instanceof Temporal.PlainDate) {
    return new Date(v.year, v.month - 1, v.day);
  }
  if (v instanceof Temporal.PlainYearMonth) {
    return new Date(v.year, v.month - 1, 1);
  }
  if (isItemDateLike(v)) {
    switch (v.kind) {
      case "date":
        return new Date(v.year!, v.month! - 1, v.day!);
      case "yearMonth":
        return new Date(v.year!, v.month! - 1, 1);
      case "year":
        return new Date(v.year!, 0, 1);
    }
  }
  return v;
}
