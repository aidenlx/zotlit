import { describe, expect, it } from "vitest";

import { Temporal } from "@zotlit/shared/temporal";

import { formatItemDate, parseItemDate, type ItemDate } from "./zt-date";

describe("parseItemDate", () => {
  it("returns null for null/undefined/empty input", () => {
    expect(parseItemDate(null)).toBeNull();
    expect(parseItemDate(undefined)).toBeNull();
    expect(parseItemDate("")).toBeNull();
  });

  it("parses a full Y-M-D multipart date", () => {
    const parsed = parseItemDate("2015-04-27 April 27, 2015");
    expect(parsed?.kind).toBe("date");
    if (parsed?.kind !== "date") throw new Error("expected date");
    expect(parsed.value.equals(Temporal.PlainDate.from("2015-04-27"))).toBe(
      true,
    );
    expect(parsed.raw).toBe("2015-04-27 April 27, 2015");
  });

  it("parses Y-M-00 as yearMonth", () => {
    const parsed = parseItemDate("2013-01-00 January 2013");
    expect(parsed?.kind).toBe("yearMonth");
    if (parsed?.kind !== "yearMonth") throw new Error("expected yearMonth");
    expect(parsed.value.equals(Temporal.PlainYearMonth.from("2013-01"))).toBe(
      true,
    );
  });

  it("parses Y-00-00 as year only", () => {
    const parsed = parseItemDate("2014-00-00 2014");
    expect(parsed).toEqual<ItemDate>({
      kind: "year",
      value: null,
      year: 2014,
      month: null,
      day: null,
      raw: "2014-00-00 2014",
    });
  });

  it("drops the spurious day in Zotero's Y-00-D misparse to year", () => {
    // Zotero parses '01 2003' as day=01, no month — the day is meaningless;
    // surfacing it as `year` preserves the sortable year and avoids inventing
    // an unsupported Temporal type for "year + day without month".
    const parsed = parseItemDate("2003-00-01 01 2003");
    expect(parsed).toEqual<ItemDate>({
      kind: "year",
      value: null,
      year: 2003,
      month: null,
      day: null,
      raw: "2003-00-01 01 2003",
    });
  });

  it("treats year=0000 (pure text) as text with stripped prefix", () => {
    const parsed = parseItemDate("0000-00-00 submitted");
    expect(parsed).toEqual<ItemDate>({
      kind: "text",
      value: null,
      text: "submitted",
      year: null,
      month: null,
      day: null,
      raw: "0000-00-00 submitted",
    });
  });

  it("treats year=0000 with month as text (e.g. 'December 19XX')", () => {
    const parsed = parseItemDate("0000-12-00 December 19XX");
    expect(parsed).toEqual<ItemDate>({
      kind: "text",
      value: null,
      text: "December 19XX",
      year: null,
      month: null,
      day: null,
      raw: "0000-12-00 December 19XX",
    });
  });

  it("treats a non-multipart raw value as text verbatim", () => {
    // Zotero's storage layer always writes multipart, but a hand-edited DB
    // (or pre-Zotero-4 leftover) could carry a raw string.
    const parsed = parseItemDate("in press");
    expect(parsed).toEqual<ItemDate>({
      kind: "text",
      value: null,
      text: "in press",
      year: null,
      month: null,
      day: null,
      raw: "in press",
    });
  });

  it("degrades an impossible full date to yearMonth (Feb 30)", () => {
    // The multipart regex accepts day 00-31 without per-month validation;
    // Temporal rejects Feb 30 with overflow:'reject'. Falling through to
    // yearMonth keeps a sortable signal instead of throwing on a dirty row.
    const parsed = parseItemDate("2015-02-30 February 30, 2015");
    expect(parsed?.kind).toBe("yearMonth");
    if (parsed?.kind !== "yearMonth") throw new Error("expected yearMonth");
    expect(parsed.value.equals(Temporal.PlainYearMonth.from("2015-02"))).toBe(
      true,
    );
  });

  it("degrades Feb 29 on a non-leap year to yearMonth", () => {
    const parsed = parseItemDate("2023-02-29 February 29, 2023");
    expect(parsed?.kind).toBe("yearMonth");
  });

  it("accepts Feb 29 on a leap year as a full date", () => {
    const parsed = parseItemDate("2024-02-29 February 29, 2024");
    expect(parsed?.kind).toBe("date");
    if (parsed?.kind !== "date") throw new Error("expected date");
    expect(parsed.value.equals(Temporal.PlainDate.from("2024-02-29"))).toBe(
      true,
    );
  });
});

describe("formatItemDate", () => {
  it("returns '' for null/undefined", () => {
    expect(formatItemDate(null)).toBe("");
    expect(formatItemDate(undefined)).toBe("");
  });

  it("returns ISO for the date variant", () => {
    expect(formatItemDate(parseItemDate("2015-04-27 April 27, 2015"))).toBe(
      "2015-04-27",
    );
  });

  it("returns ISO year-month for the yearMonth variant", () => {
    expect(formatItemDate(parseItemDate("2013-01-00 January 2013"))).toBe(
      "2013-01",
    );
  });

  it("returns the bare year for the year variant", () => {
    expect(formatItemDate(parseItemDate("2014-00-00 2014"))).toBe("2014");
  });

  it("returns the user text for the text variant (no parseable date)", () => {
    expect(formatItemDate(parseItemDate("0000-00-00 submitted"))).toBe(
      "submitted",
    );
  });

  it("returns raw verbatim for a non-multipart text variant", () => {
    expect(formatItemDate(parseItemDate("in press"))).toBe("in press");
  });
});

describe("parseItemDate toString", () => {
  it("renders ISO-normalized output for every kind", () => {
    expect(String(parseItemDate("2015-04-27 April 27, 2015"))).toBe(
      "2015-04-27",
    );
    expect(String(parseItemDate("2013-01-00 January 2013"))).toBe("2013-01");
    expect(String(parseItemDate("2014-00-00 2014"))).toBe("2014");
    expect(String(parseItemDate("0000-00-00 submitted"))).toBe("submitted");
    expect(String(parseItemDate("in press"))).toBe("in press");
  });

  it("keeps toString non-enumerable (clean spread / JSON)", () => {
    const parsed = parseItemDate("2013-01-00 January 2013")!;
    expect(Object.keys(parsed)).not.toContain("toString");
    expect(parsed.propertyIsEnumerable("toString")).toBe(false);
    expect(JSON.stringify(parsed)).not.toContain("toString");
  });
});

describe("ItemDate flat accessors", () => {
  it("exposes year/month/day/value for a full date", () => {
    const parsed = parseItemDate("2015-04-27 April 27, 2015")!;
    expect(parsed.year).toBe(2015);
    expect(parsed.month).toBe(4);
    expect(parsed.day).toBe(27);
    expect(parsed.value?.toString()).toBe("2015-04-27");
  });

  it("drops day for a yearMonth", () => {
    const parsed = parseItemDate("2013-01-00 January 2013")!;
    expect(parsed.year).toBe(2013);
    expect(parsed.month).toBe(1);
    expect(parsed.day).toBeNull();
    expect(parsed.value?.toString()).toBe("2013-01");
  });

  it("exposes only year for the year kind, value null", () => {
    const parsed = parseItemDate("2014-00-00 2014")!;
    expect(parsed.year).toBe(2014);
    expect(parsed.month).toBeNull();
    expect(parsed.day).toBeNull();
    expect(parsed.value).toBeNull();
  });

  it("regex-extracts year for text, with null month/day/value", () => {
    const parsed = parseItemDate("circa 1850")!;
    expect(parsed.year).toBe(1850);
    expect(parsed.month).toBeNull();
    expect(parsed.day).toBeNull();
    expect(parsed.value).toBeNull();

    const noYear = parseItemDate("0000-00-00 submitted")!;
    expect(noYear.year).toBeNull();
  });
});
