import { describe, expect, it } from "vitest";

import type { QueryViewRow } from "@/services/item-query/query-view";

import { resultTable, toCSV, toHTML, toTSV } from "./table";

const ROWS: QueryViewRow[] = [
  {
    indexedKey: "ANNOT001",
    values: {
      comment: 'Key figure, "panel B"',
      "item.title": "Ten simple rules",
      tags: ["figure", "methodology"],
      pageIndex: 3,
    },
  },
  {
    indexedKey: "ANNOT002",
    values: {
      comment: null,
      "item.title": "Deep learning\nA review",
      tags: [],
      pageIndex: 0,
    },
  },
];

describe("resultTable", () => {
  it("has one column for each visible property, in the view's order", () => {
    const table = resultTable(ROWS, ["item.title", "comment"]);
    expect(table).toEqual({
      header: ["item.title", "comment"],
      body: [
        ["Ten simple rules", 'Key figure, "panel B"'],
        ["Deep learning\nA review", ""],
      ],
    });
  });

  it("writes a list as its entries and a number as its digits", () => {
    expect(resultTable(ROWS, ["tags", "pageIndex"]).body).toEqual([
      ["figure, methodology", "3"],
      ["", "0"],
    ]);
  });

  it("writes an empty cell for a property the row does not carry", () => {
    expect(resultTable(ROWS, ["colorName"]).body).toEqual([[""], [""]]);
  });
});

describe("toCSV", () => {
  it("quotes a cell that holds a comma, a quote or a line break", () => {
    expect(toCSV(resultTable(ROWS, ["item.title", "comment"]))).toBe(
      'item.title,comment\nTen simple rules,"Key figure, ""panel B"""\n"Deep learning\nA review",',
    );
  });
});

describe("toTSV", () => {
  it("separates cells with tabs and quotes only what needs it", () => {
    expect(toTSV(resultTable(ROWS, ["item.title", "comment"]))).toBe(
      'item.title\tcomment\nTen simple rules\t"Key figure, ""panel B"""\n"Deep learning\nA review"\t',
    );
  });
});

describe("toHTML", () => {
  it("writes a table with escaped cells", () => {
    expect(
      toHTML({ header: ["comment"], body: [["<b>bold</b> & more"]] }),
    ).toBe(
      "<table><thead><tr><th>comment</th></tr></thead><tbody><tr><td>&lt;b&gt;bold&lt;/b&gt; &amp; more</td></tr></tbody></table>",
    );
  });
});
