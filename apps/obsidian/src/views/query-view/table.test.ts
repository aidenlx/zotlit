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

  it("writes an Item's date, creators and tags as Zotero shows them", () => {
    const item: QueryViewRow = {
      indexedKey: "RUGIER24",
      values: {
        date: {
          kind: "year",
          value: null,
          year: 2011,
          month: null,
          day: null,
          text: null,
          raw: "2011-00-00 2011",
        },
        dateAdded: {
          kind: "date",
          value: "2014-09-11",
          year: 2014,
          month: 9,
          day: 11,
          text: "September 11, 2014",
          raw: "2014-09-11 September 11, 2014",
        },
        creators: [
          { firstName: "Nicolas P.", lastName: "Rougier", fullName: null },
          { fullName: "W3C", firstName: null, lastName: null },
        ],
        tags: [
          { name: "figure", type: "manual" },
          { name: "visualization", type: "automatic" },
        ],
      },
    };
    expect(
      resultTable([item], ["date", "dateAdded", "creators", "tags"]).body,
    ).toEqual([
      [
        "2011",
        "September 11, 2014",
        "Nicolas P. Rougier, W3C",
        "figure, visualization",
      ],
    ]);
  });

  it("writes an Error Value as its message and leaves a null Formula empty", () => {
    const error = {
      kind: "error",
      code: "unparseable-text",
      message: 'number() cannot read "Deep learning" as a number.',
    };
    const rows: QueryViewRow[] = [
      { indexedKey: "A", values: { "formula.n": error } },
      { indexedKey: "B", values: { "formula.n": null } },
      { indexedKey: "C", values: { "formula.n": [1, error] } },
    ];
    expect(resultTable(rows, ["formula.n"]).body).toEqual([
      ['Error: number() cannot read "Deep learning" as a number.'],
      [""],
      ['1, Error: number() cannot read "Deep learning" as a number.'],
    ]);
  });

  it("names an Item's columns and writes its Item Type as the Table shows them", () => {
    const item: QueryViewRow = {
      indexedKey: "RUGIER24",
      values: { title: "Ten simple rules", itemType: "journalArticle" },
    };
    expect(resultTable([item], ["title", "itemType"])).toEqual({
      header: ["Title", "Item Type"],
      body: [["Ten simple rules", "Journal Article"]],
    });
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
