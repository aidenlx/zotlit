import { describe, expect, it } from "vitest";

import {
  filterFields,
  formatFilterRow,
  freshFilterRow,
  parseFilterRow,
} from "./fields";
import type { FilterFieldKind } from "./fields";

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

  it("names Item fields without a prefix on Items, and offers the Item's Tags but no Annotation or Attachment conditions", () => {
    const fields = filterFields("items");
    expect(fields.map((field) => field.kind)).toEqual([
      "item-title",
      "creators",
      "first-author",
      "year",
      "item-type",
      "collection",
      "library",
      "tags",
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

  it("stores nothing for the starting row of every condition, which has no value", () => {
    for (const field of fields)
      expect(formatFilterRow(freshFilterRow(field), fields)).toBeNull();
  });

  it("stores an empty test without a value", () => {
    const title = fields.find((field) => field.kind === "item-title")!;
    expect(
      formatFilterRow(
        { kind: "item-title", operator: "is-empty", value: "", values: [] },
        fields,
      ),
    ).toBe(`${title.path}.isEmpty()`);
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

describe("a field the host adds", () => {
  const status = {
    kind: "custom:reading-status",
    path: 'vault["reading-status"]',
    type: "text",
    label: "reading-status",
  } as const;
  const fields = [...filterFields("items"), status];

  it.each([
    [
      { kind: status.kind, operator: "is", value: "read", values: [] },
      'vault["reading-status"] == "read"',
    ],
    [
      { kind: status.kind, operator: "contains", value: "re", values: [] },
      'vault["reading-status"].contains("re")',
    ],
    [
      { kind: status.kind, operator: "is-not-empty", value: "", values: [] },
      '!vault["reading-status"].isEmpty()',
    ],
  ] as const)(
    "writes %j in bracket form as %s, and reads it back",
    (row, text) => {
      expect(formatFilterRow({ ...row, values: [] }, fields)).toBe(text);
      expect(parseFilterRow(text, fields)).toEqual({ ...row, values: [] });
    },
  );
});
