import { describe, expect, it } from "vitest";

import {
  filterFields,
  formatFilterRow,
  freshFilterRow,
  parseFilterRow,
} from "./filter-fields";
import type { FilterFieldKind } from "./filter-fields";

const ANNOTATION_KINDS: FilterFieldKind[] = [
  "color",
  "tags",
  "comment",
  "text",
  "page",
  "date-added",
  "date-modified",
  "item-title",
  "creators",
  "first-author",
  "year",
  "item-type",
  "collection",
  "library",
  "attachment-title",
  "file-type",
];

describe("filterFields", () => {
  it("offers Annotation, Item and Attachment conditions on Annotations", () => {
    expect(filterFields("annotations").map((field) => field.kind)).toEqual(
      ANNOTATION_KINDS,
    );
  });

  it("names Item fields without a prefix on Items, and offers no Annotation or Attachment conditions", () => {
    const fields = filterFields("items");
    expect(fields.map((field) => field.kind)).toEqual([
      "item-title",
      "creators",
      "first-author",
      "year",
      "item-type",
      "collection",
      "library",
    ]);
    expect(fields.find((field) => field.kind === "year")?.path).toBe(
      "date.year",
    );
  });

  it("names Attachment fields without a prefix on Attachments", () => {
    const fields = filterFields("attachments");
    expect(fields.find((field) => field.kind === "file-type")?.path).toBe(
      "fileType",
    );
    expect(fields.find((field) => field.kind === "item-title")?.path).toBe(
      "item.title",
    );
  });
});

describe("formatFilterRow", () => {
  const fields = filterFields("annotations");
  it.each([
    [
      { kind: "color", operator: "is", value: "yellow", values: [] },
      'colorName == "yellow"',
    ],
    [
      {
        kind: "comment",
        operator: "does-not-contain",
        value: "todo",
        values: [],
      },
      '!comment.contains("todo")',
    ],
    [
      { kind: "comment", operator: "is-empty", value: "", values: [] },
      "comment.isEmpty()",
    ],
    [
      {
        kind: "tags",
        operator: "contains-any",
        value: "",
        values: ["figure", "method"],
      },
      'tags.containsAny("figure", "method")',
    ],
    [
      {
        kind: "collection",
        operator: "within",
        value: "Thesis/Methods",
        values: [],
      },
      'item.collections.within("Thesis/Methods")',
    ],
    [
      { kind: "year", operator: "on-or-after", value: "2020", values: [] },
      "item.date.year >= 2020",
    ],
    [
      {
        kind: "date-added",
        operator: "before",
        value: "2024-05-01",
        values: [],
      },
      'dateAdded < date("2024-05-01")',
    ],
    [
      {
        kind: "first-author",
        operator: "contains",
        value: "Lovelace",
        values: [],
      },
      'item.firstAuthor.fullName.contains("Lovelace")',
    ],
    [
      { kind: "library", operator: "is-not", value: "group:4815", values: [] },
      'library != "group:4815"',
    ],
    [
      { kind: "file-type", operator: "is", value: "pdf", values: [] },
      'attachment.fileType == "pdf"',
    ],
  ] as const)("writes %j as %s", (row, text) => {
    expect(formatFilterRow({ ...row, values: [...row.values] }, fields)).toBe(
      text,
    );
    expect(parseFilterRow(text, fields)).toEqual({
      ...row,
      values: [...row.values],
    });
  });

  it("reads back the starting row of every condition", () => {
    for (const field of fields) {
      const row = freshFilterRow(field);
      expect(parseFilterRow(formatFilterRow(row, fields), fields)).toEqual(row);
    }
  });
});

describe("parseFilterRow", () => {
  const fields = filterFields("annotations");
  it.each([
    'colorName == "yellow" && comment != null',
    "item.date.year >= 2020 + 1",
    'tags.contains("a", "b")',
    "unknownField == 1",
    "colorName ==",
    'title.contains("Ada")',
  ])("keeps %s as an expression", (text) => {
    expect(parseFilterRow(text, fields)).toBeNull();
  });

  it("reads a condition in parentheses", () => {
    expect(parseFilterRow('(colorName != "red")', fields)).toEqual({
      kind: "color",
      operator: "is-not",
      value: "red",
      values: [],
    });
  });
});
