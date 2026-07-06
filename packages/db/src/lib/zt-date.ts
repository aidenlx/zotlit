import { regex } from "arkregex";

import { Temporal } from "@zotlit/shared/temporal";

import { defineToString } from "./to-string";

/** Full Y/M/D date parsed into a `Temporal.PlainDate`. */
export interface ItemDateYMD {
  kind: "date";
  value: Temporal.PlainDate;
  year: number;
  month: number;
  day: number;
  raw: string;
  toString(): string;
}

/** Year and month only; `Temporal.PlainYearMonth` (no day). */
export interface ItemDateYearMonth {
  kind: "yearMonth";
  value: Temporal.PlainYearMonth;
  year: number;
  month: number;
  day: null;
  raw: string;
  toString(): string;
}

/**
 * Year only. Also covers Zotero's `01 2003` misparse where the user-string day
 * is meaningful but month is missing (the spurious day is dropped since no
 * `Temporal` type fits "year + day without month").
 */
export interface ItemDateYear {
  kind: "year";
  value: null;
  year: number;
  month: null;
  day: null;
  raw: string;
  toString(): string;
}

/**
 * Unparseable / text-only: year is missing or the SQL prefix is absent. `text`
 * holds the renderable user portion (or the entire raw value if non-multipart);
 * `year` is regex-extracted from it when a `\d{4}` run is present, else null.
 */
export interface ItemDateText {
  kind: "text";
  value: null;
  text: string;
  year: number | null;
  month: null;
  day: null;
  raw: string;
  toString(): string;
}

/**
 * Parsed view of Zotero's "multipart" date field.
 *
 * Zotero stores the `date` field as `YYYY-MM-DD <user text>` where any of
 * year/month/day may be `00` to mark missing precision (e.g.
 * `2013-01-00 January 2013`, `0000-00-00 submitted`).
 *
 * Every variant exposes the common parts so templates can read them without
 * narrowing on `kind`:
 * - `year`  — numeric year (regex-extracted for {@link ItemDateText}); null
 *   only when none is found.
 * - `month` — 1–12 when known, else null.
 * - `day`   — day-of-month for full dates ({@link ItemDateYMD}) only, else null.
 * - `value` — precise `Temporal` value; null for {@link ItemDateYear} /
 *   {@link ItemDateText}.
 * - `raw`   — verbatim stored value, retained for round-tripping.
 * - `toString()` — ISO-normalized rendering (see {@link formatItemDate});
 *   drives `${date}`.
 *
 * `kind` narrows `value` to its concrete `Temporal` type for TS consumers.
 */
export type ItemDate =
  | ItemDateYMD
  | ItemDateYearMonth
  | ItemDateYear
  | ItemDateText;

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

const YEAR_RE = regex("\\b[12]\\d{3}\\b");

/**
 * The returned object carries a non-enumerable `toString` (ISO-normalized, via
 * {@link formatItemDate}) so `<%= zt.date %>` renders a machine-friendly date,
 * while `zt.date.value` stays available for locale formatting (e.g.
 * `zt.date.value?.toLocaleString(...)`). `toString` is hidden from spread /
 * `JSON.stringify` / `Object.keys`.
 */
export function parseItemDate(raw: string | null | undefined): ItemDate | null {
  const date = parseItemDateInner(raw);
  return date && withToString(date);
}

/** Attaches the {@link formatItemDate} rendering as the date's `toString`. */
export function withToString(date: ItemDate): ItemDate {
  return defineToString(date, function () {
    return formatItemDate(this);
  });
}

function parseItemDateInner(raw: string | null | undefined): ItemDate | null {
  if (!raw) return null;

  const match = MULTIPART_RE.exec(raw);
  if (!match) return textDate(raw, raw);

  const { year: yearStr, month: monthStr, day: dayStr, text } = match.groups;

  if (yearStr === "0000") return textDate(text, raw);

  const year = Number(yearStr);
  if (monthStr === "00") return yearOnly(year, raw);

  const month = Number(monthStr);
  if (dayStr === "00") {
    return tryYearMonth({ year, month }, raw) ?? yearOnly(year, raw);
  }

  const day = Number(dayStr);
  return (
    tryDate({ year, month, day }, raw) ??
    tryYearMonth({ year, month }, raw) ??
    yearOnly(year, raw)
  );
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
      return date.value.toString();
    case "year":
      return String(date.year);
    case "text":
      return date.text;
  }
}

export function textDate(text: string, raw: string): ItemDateText {
  const match = YEAR_RE.exec(text);
  return {
    kind: "text",
    value: null,
    text,
    year: match ? Number(match[0]) : null,
    month: null,
    day: null,
    raw,
  };
}

export function yearOnly(year: number, raw: string): ItemDateYear {
  return { kind: "year", value: null, year, month: null, day: null, raw };
}

export function tryDate(
  parts: { year: number; month: number; day: number },
  raw: string,
): ItemDateYMD | null {
  try {
    const value = Temporal.PlainDate.from(parts, { overflow: "reject" });
    return {
      kind: "date",
      value,
      year: value.year,
      month: value.month,
      day: value.day,
      raw,
    };
  } catch {
    return null;
  }
}

export function tryYearMonth(
  parts: { year: number; month: number },
  raw: string,
): ItemDateYearMonth | null {
  try {
    const value = Temporal.PlainYearMonth.from(parts, { overflow: "reject" });
    return {
      kind: "yearMonth",
      value,
      year: value.year,
      month: value.month,
      day: null,
      raw,
    };
  } catch {
    return null;
  }
}
