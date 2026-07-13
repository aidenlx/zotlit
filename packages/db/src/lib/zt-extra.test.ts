import { describe, expect, it } from "vitest";

import { parseItemExtra } from "./zt-extra";

describe("parseItemExtra", () => {
  it("returns null for null/undefined/empty/whitespace input", () => {
    expect(parseItemExtra(null)).toBeNull();
    expect(parseItemExtra(undefined)).toBeNull();
    expect(parseItemExtra("")).toBeNull();
    expect(parseItemExtra("   \n\t  ")).toBeNull();
  });

  it("keeps the verbatim raw string", () => {
    const raw = "tex.mendeley-tags: reliability\nsome prose\nDOI: 10.1/x";
    expect(parseItemExtra(raw)?.raw).toBe(raw);
  });

  it("String(result) returns the raw text", () => {
    const raw = "DOI: 10.1/x\nplain line";
    expect(String(parseItemExtra(raw))).toBe(raw);
  });

  it("keeps toString non-enumerable (clean spread / JSON)", () => {
    const parsed = parseItemExtra("DOI: 10.1/x")!;
    expect(Object.keys(parsed)).not.toContain("toString");
    expect(parsed.propertyIsEnumerable("toString")).toBe(false);
    expect(JSON.stringify(parsed)).not.toContain("toString");
  });

  it("gives each line a toString returning its raw text", () => {
    const raw = "DOI: 10.1/x\n\nsome free prose";
    const parsed = parseItemExtra(raw)!;
    expect(parsed.lines.map(String)).toEqual([
      "DOI: 10.1/x",
      "",
      "some free prose",
    ]);
    expect(parsed.lines[0]!.propertyIsEnumerable("toString")).toBe(false);
  });

  it("parses tex.* and dotted/spaced/hyphenated keys", () => {
    const parsed = parseItemExtra(
      "tex.mendeley-tags: reliability,transport economics\n" +
        "Citation Key: smith2024\n" +
        "Original Date: 1999",
    )!;
    expect(parsed.fields).toEqual({
      "tex.mendeley-tags": "reliability,transport economics",
      "Citation Key": "smith2024",
      "Original Date": "1999",
    });
  });

  it("splits only on the first delimiter so values keep later colons", () => {
    const parsed = parseItemExtra("URL: https://x/a:b\ntime: 10:30")!;
    expect(parsed.fields.URL).toBe("https://x/a:b");
    expect(parsed.fields.time).toBe("10:30");
  });

  it("accepts = as a delimiter alongside :", () => {
    const parsed = parseItemExtra("tex.ids = smith2024\ncitation-key: c")!;
    expect(parsed.fields["tex.ids"]).toBe("smith2024");
    expect(parsed.fields["citation-key"]).toBe("c");
  });

  it("first occurrence wins in fields; all occurrences kept in lines", () => {
    const parsed = parseItemExtra(
      "tex.mendeley-tags: first\ntex.mendeley-tags: second",
    )!;
    expect(parsed.fields["tex.mendeley-tags"]).toBe("first");
    const values = parsed.lines
      .filter((line) => line.key === "tex.mendeley-tags")
      .map((line) => (line.key !== null ? line.value : null));
    expect(values).toEqual(["first", "second"]);
  });

  it("treats Object prototype names as ordinary keys", () => {
    const parsed = parseItemExtra(
      "toString: custom\nconstructor: custom constructor",
    )!;
    expect(parsed.fields["toString"]).toBe("custom");
    expect(parsed.fields["constructor"]).toBe("custom constructor");

    const withoutCollisions = parseItemExtra("DOI: 10.1/x")!;
    expect("toString" in withoutCollisions.fields).toBe(false);
    expect("constructor" in withoutCollisions.fields).toBe(false);
  });

  it("classifies an empty-value line as a text row, not a pair", () => {
    const parsed = parseItemExtra("DOI:\nISBN:   \ntitle: real")!;
    expect(parsed.fields).toEqual({ title: "real" });
    expect(parsed.lines[0]).toEqual({ raw: "DOI:", key: null });
    expect(parsed.lines[1]).toEqual({ raw: "ISBN:   ", key: null });
  });

  it("preserves blank lines and interleaved prose in order as text rows", () => {
    const raw = "DOI: 10.1/x\n\nsome free prose\nISBN: 978";
    const parsed = parseItemExtra(raw)!;
    expect(parsed.lines).toEqual([
      { raw: "DOI: 10.1/x", key: "DOI", value: "10.1/x" },
      { raw: "", key: null },
      { raw: "some free prose", key: null },
      { raw: "ISBN: 978", key: "ISBN", value: "978" },
    ]);
  });

  it("splits Windows CRLF line endings the same as LF", () => {
    const parsed = parseItemExtra("DOI: 10.1/x\r\nISBN: 978")!;
    expect(parsed.lines).toEqual([
      { raw: "DOI: 10.1/x", key: "DOI", value: "10.1/x" },
      { raw: "ISBN: 978", key: "ISBN", value: "978" },
    ]);
  });

  it("trims key and value but keeps the row raw verbatim", () => {
    const parsed = parseItemExtra("DOI  :   10.1/x  ")!;
    expect(parsed.fields).toEqual({ DOI: "10.1/x" });
    expect(parsed.lines[0]).toEqual({
      raw: "DOI  :   10.1/x  ",
      key: "DOI",
      value: "10.1/x",
    });
  });

  it("treats a leading-whitespace line as a text row (key must start the line)", () => {
    const parsed = parseItemExtra("  DOI: 10.1/x")!;
    expect(parsed.fields).toEqual({});
    expect(parsed.lines[0]).toEqual({ raw: "  DOI: 10.1/x", key: null });
  });

  it("keys are case-sensitive and never normalized", () => {
    const parsed = parseItemExtra("DOI: a\ndoi: b")!;
    expect(parsed.fields).toEqual({ DOI: "a", doi: "b" });
  });
});
