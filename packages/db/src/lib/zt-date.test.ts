import { describe, expect, it } from "vitest";

import { Temporal } from "@zotlit/shared/temporal";

import {
  formatItemDate,
  itemDateYear,
  parseItemDate,
  type ItemDate,
} from "./zt-date";

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
    expect(parsed.plain.equals(Temporal.PlainDate.from("2015-04-27"))).toBe(
      true,
    );
    expect(parsed.raw).toBe("2015-04-27 April 27, 2015");
  });

  it("parses Y-M-00 as yearMonth", () => {
    const parsed = parseItemDate("2013-01-00 January 2013");
    expect(parsed?.kind).toBe("yearMonth");
    if (parsed?.kind !== "yearMonth") throw new Error("expected yearMonth");
    expect(parsed.plain.equals(Temporal.PlainYearMonth.from("2013-01"))).toBe(
      true,
    );
  });

  it("parses Y-00-00 as year only", () => {
    const parsed = parseItemDate("2014-00-00 2014");
    expect(parsed).toEqual<ItemDate>({
      kind: "year",
      year: 2014,
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
      year: 2003,
      raw: "2003-00-01 01 2003",
    });
  });

  it("treats year=0000 (pure text) as text with stripped prefix", () => {
    const parsed = parseItemDate("0000-00-00 submitted");
    expect(parsed).toEqual<ItemDate>({
      kind: "text",
      text: "submitted",
      raw: "0000-00-00 submitted",
    });
  });

  it("treats year=0000 with month as text (e.g. 'December 19XX')", () => {
    const parsed = parseItemDate("0000-12-00 December 19XX");
    expect(parsed).toEqual<ItemDate>({
      kind: "text",
      text: "December 19XX",
      raw: "0000-12-00 December 19XX",
    });
  });

  it("treats a non-multipart raw value as text verbatim", () => {
    // Zotero's storage layer always writes multipart, but a hand-edited DB
    // (or pre-Zotero-4 leftover) could carry a raw string. Don't blow up.
    const parsed = parseItemDate("in press");
    expect(parsed).toEqual<ItemDate>({
      kind: "text",
      text: "in press",
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
    expect(parsed.plain.equals(Temporal.PlainYearMonth.from("2015-02"))).toBe(
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
    expect(parsed.plain.equals(Temporal.PlainDate.from("2024-02-29"))).toBe(
      true,
    );
  });
});

describe("itemDateYear", () => {
  it("returns null for null/undefined", () => {
    expect(itemDateYear(null)).toBeNull();
    expect(itemDateYear(undefined)).toBeNull();
  });

  it("reads the structured year for each typed variant", () => {
    expect(itemDateYear(parseItemDate("2015-04-27 April 27, 2015"))).toBe(2015);
    expect(itemDateYear(parseItemDate("2013-01-00 January 2013"))).toBe(2013);
    expect(itemDateYear(parseItemDate("2014-00-00 2014"))).toBe(2014);
    expect(itemDateYear(parseItemDate("2003-00-01 01 2003"))).toBe(2003);
  });

  it("regex-extracts a 1xxx/2xxx year from text variants", () => {
    expect(itemDateYear(parseItemDate("0000-00-00 around 1995"))).toBe(1995);
    expect(itemDateYear(parseItemDate("circa 1850"))).toBe(1850);
  });

  it("returns null when text has no 1xxx/2xxx run", () => {
    expect(itemDateYear(parseItemDate("0000-00-00 submitted"))).toBeNull();
    expect(itemDateYear(parseItemDate("0000-12-00 December 19XX"))).toBeNull();
    expect(itemDateYear(parseItemDate("0000-00-00 9999"))).toBeNull();
  });
});

describe("formatItemDate", () => {
  it("returns '' for null/undefined", () => {
    expect(formatItemDate(null)).toBe("");
    expect(formatItemDate(undefined)).toBe("");
  });

  it("returns the user portion for the date variant", () => {
    expect(formatItemDate(parseItemDate("2015-04-27 April 27, 2015"))).toBe(
      "April 27, 2015",
    );
  });

  it("returns the user portion for the yearMonth variant", () => {
    expect(formatItemDate(parseItemDate("2013-01-00 January 2013"))).toBe(
      "January 2013",
    );
  });

  it("returns the user portion for the year variant", () => {
    expect(formatItemDate(parseItemDate("2014-00-00 2014"))).toBe("2014");
  });

  it("returns the user portion for the text variant (multipart prefix stripped)", () => {
    expect(formatItemDate(parseItemDate("0000-00-00 submitted"))).toBe(
      "submitted",
    );
  });

  it("returns raw verbatim for a non-multipart text variant", () => {
    expect(formatItemDate(parseItemDate("in press"))).toBe("in press");
  });
});
