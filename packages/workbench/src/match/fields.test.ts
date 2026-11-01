import { describe, expect, it } from "vitest";

import {
  FILTER_OPERATORS,
  filterFields,
  formatFilterRow,
  freshFilterRow,
  parseFilterRow,
  withOperator,
} from "./fields";
import type { FilterField, FilterFieldKind } from "./fields";

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

const leading = (fields: readonly FilterField[]) =>
  fields
    .map((field) => field.kind)
    .filter((kind) => !kind.startsWith("field:"));

describe("filterFields", () => {
  it("offers Annotation, Item and Attachment conditions on Annotations", () => {
    expect(leading(filterFields("annotations"))).toEqual(ANNOTATION_KINDS);
  });

  it("offers every field the dataset's planner can read, after the common ones", () => {
    const fields = filterFields("items");
    const at = (path: string) => fields.findIndex((f) => f.path === path);
    expect(fields.find((f) => f.path === "publicationTitle")).toMatchObject({
      kind: "field:publicationTitle",
      type: "text",
    });
    expect(fields.find((f) => f.path === "dateAdded")?.type).toBe("date");
    expect(fields.find((f) => f.path === "date.month")?.type).toBe("number");
    expect(at("DOI")).toBeGreaterThan(at("tags"));
    expect(at("date.text")).toBe(-1);
    expect(fields.filter((f) => f.path === "date.year")).toHaveLength(1);
  });

  it("offers a whole date field beside its parts", () => {
    const type = (dataset: "annotations" | "items", path: string) =>
      filterFields(dataset).find((f) => f.path === path)?.type;
    expect(type("items", "date")).toBe("date");
    expect(type("items", "filingDate")).toBe("date");
    expect(type("annotations", "item.issueDate")).toBe("date");
    // A record is no condition of its own, though its parts are.
    expect(type("items", "firstAuthor")).toBeUndefined();
  });

  it("offers the Item's fields on the datasets below it", () => {
    expect(
      filterFields("annotations").find(
        (f) => f.path === "item.publicationTitle",
      )?.type,
    ).toBe("text");
    expect(
      filterFields("attachments").find((f) => f.path === "exists")?.type,
    ).toBe("boolean");
  });

  it("carries the words a list finds a field by", () => {
    const journal = filterFields("items").find(
      (f) => f.path === "publicationTitle",
    );
    expect(journal?.searchTerms).toContain("journal");
  });

  it("writes and reads a condition by the field's name alone", () => {
    const fields = filterFields("items");
    const field = fields.find((f) => f.path === "publicationTitle")!;
    const row = { ...freshFilterRow(field), value: "Nature" };
    const text = formatFilterRow(row, fields)!;
    expect(text).toBe('publicationTitle.icontains("Nature")');
    expect(parseFilterRow(text, fields)).toEqual(row);
  });

  it("names Item fields without a prefix on Items, and offers the Item's Tags but no Annotation or Attachment conditions", () => {
    const fields = filterFields("items");
    expect(leading(fields)).toEqual([
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
      '!comment.icontains("todo")',
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
      'item.firstAuthor.fullName.icontains("Lovelace")',
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
    for (const field of fields.filter((f) => f.type !== "boolean"))
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
      'vault["reading-status"].icontains("re")',
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

describe("a boolean field", () => {
  const done = {
    kind: "custom:done",
    path: "vault.done",
    type: "boolean",
    label: "done",
  } as const;
  const fields = [...filterFields("items"), done];

  it("offers is true and is false, and starts a row at is true", () => {
    expect(freshFilterRow(done)).toEqual({
      kind: done.kind,
      operator: "is-true",
      value: "",
      values: [],
    });
  });

  it.each([
    ["is-true", "vault.done == true"],
    ["is-false", "vault.done == false"],
  ] as const)(
    "writes %s as %s, with no value, and reads it back",
    (operator, text) => {
      const row = { kind: done.kind, operator, value: "", values: [] };
      expect(formatFilterRow(row, fields)).toBe(text);
      expect(parseFilterRow(text, fields)).toEqual(row);
    },
  );

  it("reads a comparison with a string as no row of the field", () => {
    expect(parseFilterRow('vault.done == "true"', fields)).toBeNull();
  });
});

describe("text containment rows", () => {
  const vault: FilterField = {
    kind: "custom:journal",
    path: 'vault["journal"]',
    type: "text",
  };
  const fields = [...filterFields("items"), vault];
  const operators = [
    ["contains", 'icontains("Nature")'],
    ["does-not-contain", 'icontains("Nature")'],
    ["contains-match-case", 'contains("Nature")'],
    ["does-not-contain-match-case", 'contains("Nature")'],
  ] as const;

  it("offers case-insensitive rows first on text fields", () => {
    expect(FILTER_OPERATORS.text).toEqual([
      ...operators.map(([operator]) => operator),
      "is",
      "is-not",
      "is-empty",
      "is-not-empty",
    ]);
  });

  it.each(operators)(
    "round trips %s on a title and a vault text field",
    (operator, call) => {
      for (const field of [
        fields.find((entry) => entry.path === "title")!,
        vault,
      ]) {
        const row = { ...freshFilterRow(field), operator, value: "Nature" };
        const text = `${operator.startsWith("does-not") ? "!" : ""}${field.path}.${call}`;
        expect(formatFilterRow(row, fields)).toBe(text);
        expect(parseFilterRow(text, fields)).toEqual(row);
        for (const [next] of operators)
          expect(withOperator(row, next)).toEqual({ ...row, operator: next });
      }
    },
  );

  it("reads a saved contains expression as a match-case row", () => {
    expect(parseFilterRow('title.contains("x")', fields)).toEqual({
      kind: "item-title",
      operator: "contains-match-case",
      value: "x",
      values: [],
    });
  });

  it.each(["tags", "collections"])("keeps contains on %s", (path) => {
    const field = fields.find((entry) => entry.path === path)!;
    for (const operator of ["contains", "does-not-contain"] as const) {
      const row = { ...freshFilterRow(field), operator, value: "Nature" };
      const text = `${operator === "does-not-contain" ? "!" : ""}${path}.contains("Nature")`;
      expect(formatFilterRow(row, fields)).toBe(text);
      expect(parseFilterRow(text, fields)).toEqual(row);
    }
    expect(parseFilterRow(`${path}.icontains("Nature")`, fields)).toBeNull();
  });
});
