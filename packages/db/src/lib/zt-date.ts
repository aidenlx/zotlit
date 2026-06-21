import { regex } from "arkregex";

import { Temporal } from "@zotlit/shared/temporal";

import { defineToString } from "./to-string";

/**
 * Parsed view of Zotero's "multipart" date field.
 *
 * Zotero stores the `date` field as `YYYY-MM-DD <user text>` where any of
 * year/month/day may be `00` to mark missing precision (e.g.
 * `2013-01-00 January 2013`, `0000-00-00 submitted`).
 *
 * - `date`      — full Y/M/D parsed into `Temporal.PlainDate`.
 * - `yearMonth` — only Y/M; `Temporal.PlainYearMonth`.
 * - `year`      — only Y; also covers Zotero's `01 2003` misparse where the
 *   user-string day is meaningful but month is missing (the spurious day
 *   is dropped since no Temporal type fits "year + day without month").
 * - `text`      — year is missing or the SQL prefix is absent. `text` holds
 *   the renderable user portion (or the entire raw value if non-multipart).
 *
 * `raw` is always the verbatim stored value, retained for round-tripping.
 */
export type ItemDate = (
  | { kind: "date"; plain: Temporal.PlainDate; raw: string }
  | { kind: "yearMonth"; plain: Temporal.PlainYearMonth; raw: string }
  | { kind: "year"; year: number; raw: string }
  | { kind: "text"; text: string; raw: string }
) & {
  /** ISO-normalized rendering (see {@link formatItemDate}); drives `${date}`. */
  toString(): string;
};

/**
 * Ported verbatim from upstream Zotero (with named captures added for typed
 * access). Day range is per-month-agnostic; calendar validity is checked
 * separately via `Temporal`.
 *
 * @see https://github.com/zotero/utilities/blob/fbc4d6ad1c947035404db4321912ed46fb113380/date.js#L668
 */
const MULTIPART_RE = regex(
  "^(?<year>[0-9]{4})-(?<month>0[0-9]|10|11|12)-(?<day>0[0-9]|[1-2][0-9]|30|31) (?<text>[\\s\\S]*)$",
);

const YEAR_RE = regex("[12]\\d{3}");

/**
 * The returned object carries a non-enumerable `toString` (ISO-normalized, via
 * {@link formatItemDate}) so `<%= zt.date %>` renders a machine-friendly date
 * while `zt.date.plain` stays available for locale formatting.
 */
export function parseItemDate(raw: string | null | undefined): ItemDate | null {
  const date = parseItemDateInner(raw);
  return (
    date &&
    defineToString(date, function () {
      return formatItemDate(this);
    })
  );
}

function parseItemDateInner(raw: string | null | undefined): ItemDate | null {
  if (!raw) return null;

  const match = MULTIPART_RE.exec(raw);
  if (!match) return { kind: "text", text: raw, raw };

  const { year: yearStr, month: monthStr, day: dayStr, text } = match.groups;

  if (yearStr === "0000") return { kind: "text", text, raw };

  const year = Number(yearStr);
  if (monthStr === "00") return { kind: "year", year, raw };

  const month = Number(monthStr);
  if (dayStr === "00") {
    return tryYearMonth({ year, month }, raw) ?? { kind: "year", year, raw };
  }

  const day = Number(dayStr);
  return (
    tryDate({ year, month, day }, raw) ??
    tryYearMonth({ year, month }, raw) ?? { kind: "year", year, raw }
  );
}

/**
 * - Structured kinds (`date` / `yearMonth` / `year`) return their stored year.
 * - `text` falls back to a `\d{4}` regex over the user text; returns `null`
 *   when no 4-digit run is present (e.g. `submitted`, `January 19XX`).
 */
export function itemDateYear(date: ItemDate | null | undefined): number | null {
  if (!date) return null;
  switch (date.kind) {
    case "date":
    case "yearMonth":
      return date.plain.year;
    case "year":
      return date.year;
    case "text": {
      const match = YEAR_RE.exec(date.text);
      return match ? Number(match[0]) : null;
    }
  }
}

/**
 * ISO-normalized rendering: `date` / `yearMonth` via their `Temporal` value
 * (`2015-04-27`, `2013-01`), `year` as the bare year. The `text` kind has no
 * parseable date, so its raw user text is returned verbatim.
 */
export function formatItemDate(date: ItemDate | null | undefined): string {
  if (!date) return "";
  switch (date.kind) {
    case "date":
    case "yearMonth":
      return date.plain.toString();
    case "year":
      return String(date.year);
    case "text":
      return date.text;
  }
}

function tryDate(
  parts: { year: number; month: number; day: number },
  raw: string,
): Extract<ItemDate, { kind: "date" }> | null {
  try {
    return {
      kind: "date",
      plain: Temporal.PlainDate.from(parts, { overflow: "reject" }),
      raw,
    };
  } catch {
    return null;
  }
}

function tryYearMonth(
  parts: { year: number; month: number },
  raw: string,
): Extract<ItemDate, { kind: "yearMonth" }> | null {
  try {
    return {
      kind: "yearMonth",
      plain: Temporal.PlainYearMonth.from(parts, { overflow: "reject" }),
      raw,
    };
  } catch {
    return null;
  }
}
