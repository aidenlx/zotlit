import { describe, expect, it } from "vitest";

import { delimited, delimitedLines, delimitedStart } from "./delimited";

const BOM = String.fromCharCode(0xfeff);

const lines = [
  ["title", "year"],
  ["Paper A", "2020"],
];

describe("delimited", () => {
  it("writes CSV with a byte order mark and each line ended by CRLF", () => {
    expect(delimited(lines, "csv")).toBe(
      `${BOM}title,year\r\nPaper A,2020\r\n`,
    );
  });

  it("writes TSV with no byte order mark and each line ended by LF", () => {
    expect(delimited(lines, "tsv")).toBe("title\tyear\nPaper A\t2020\n");
  });

  it("quotes a cell that holds the separator, a quote, a line feed or a carriage return, and doubles each quote", () => {
    expect(
      delimitedLines([["a,b", 'say "hi"', "one\ntwo", "three\r\nfour"]], "csv"),
    ).toBe('"a,b","say ""hi""","one\ntwo","three\r\nfour"\r\n');
    // A carriage return alone is quoted too.
    expect(delimitedLines([["a\rb", "c"]], "csv")).toBe('"a\rb",c\r\n');
    expect(delimitedLines([["a\rb"]], "tsv")).toBe('"a\rb"\n');
    // A comma is plain text in TSV; a tab is quoted.
    expect(delimitedLines([["a,b", "c\td"]], "tsv")).toBe('a,b\t"c\td"\n');
  });

  it("writes only the byte order mark for no lines, and an empty line for a line of no cells", () => {
    expect(delimited([], "csv")).toBe(BOM);
    expect(delimited([], "tsv")).toBe("");
    expect(delimitedLines([[]], "csv")).toBe("\r\n");
  });

  it("starts a text in parts with the byte order mark alone", () => {
    const [header, ...body] = lines;
    expect(
      delimitedStart("csv") +
        delimitedLines([header!], "csv") +
        delimitedLines(body, "csv"),
    ).toBe(delimited(lines, "csv"));
  });
});
