import * as v from "valibot";
import { describe, expect, it } from "vitest";

import { defaults, schema } from "./schema";

describe("schema/defaults invariants", () => {
  it("defaults stay aligned with schema entries", () => {
    expect(Object.keys(defaults).sort()).toEqual(
      Object.keys(schema.entries).sort(),
    );
  });

  it("defaults satisfy the schema", () => {
    const result = v.safeParse(schema, defaults);
    expect(result.success).toBe(true);
  });

  it("trims frontmatter fields and requires unique keys", () => {
    const entry = schema.entries["note.frontmatter-fields"];
    const result = v.safeParse(entry, [
      {
        key: " title ",
        expr: " zt.title ",
        merge: "replace",
        language: "liquid",
      },
    ]);

    expect(result.success).toBe(true);
    expect(result.output).toEqual([
      { key: "title", expr: "zt.title", merge: "replace", language: "liquid" },
    ]);

    expect(
      v.safeParse(entry, [
        {
          key: "title",
          expr: "zt.title",
          merge: "replace",
          language: "liquid",
        },
        {
          key: "title",
          expr: "zt.shortTitle",
          merge: "keep",
          language: "liquid",
        },
      ]).success,
    ).toBe(false);
  });

  it("requires frontmatter merge strategy", () => {
    expect(
      v.safeParse(schema.entries["note.frontmatter-fields"], [
        { key: "title", expr: "zt.title", language: "liquid" },
      ]).success,
    ).toBe(false);
  });

  it("requires frontmatter language", () => {
    expect(
      v.safeParse(schema.entries["note.frontmatter-fields"], [
        { key: "title", expr: "zt.title", merge: "replace" },
      ]).success,
    ).toBe(false);
  });

  it("stores only added literature note profiles and requires stable unique ids", () => {
    const entry = schema.entries["note.profiles"];
    const books = {
      id: "V1StGXR8Z5jd",
      label: "Books",
      document: "books.md",
      bindings: { "note.literature-folder": "Books" },
    };

    expect(defaults["note.profiles"]).toEqual([]);
    expect(v.safeParse(entry, [books]).success).toBe(true);
    expect(
      v.safeParse(entry, [
        { ...books, id: "36c4f8b4-4f65-4cab-8c51-c921ea616cc8" },
      ]).success,
    ).toBe(false);
    expect(v.safeParse(entry, [{ ...books, id: "Books" }]).success).toBe(false);
    expect(v.safeParse(entry, [{ ...books, id: "V1StGXR8_Z5j" }]).success).toBe(
      false,
    );
    expect(v.safeParse(entry, [{ ...books, id: "V1StGXR8-Z5j" }]).success).toBe(
      false,
    );
    expect(v.safeParse(entry, [books, books]).success).toBe(false);
    expect(v.safeParse(entry, [{ ...books, document: "   " }]).success).toBe(
      false,
    );
  });

  it("keeps every built-in default Profile binding total", () => {
    const entry = schema.entries["note.default-profile"];

    expect(defaults["note.default-profile"]).toEqual({
      bindings: {
        "note.literature-folder": "literatures",
        "citation.references-style": null,
        "note.import-folder": "zotero_notes",
        "note.import-colored-highlights": false,
        "note.import-annotations-as-template": false,
      },
    });
    expect(v.safeParse(entry, {}).success).toBe(false);
    expect(
      v.safeParse(entry, {
        document: "literature-note.md",
        bindings: defaults["note.default-profile"].bindings,
      }).success,
    ).toBe(true);
    expect(v.safeParse(entry, { document: "   " }).success).toBe(false);
  });

  it("keeps profile bindings sparse and validates each supplied binding", () => {
    const entry = schema.entries["note.profiles"];
    const base = {
      id: "V1StGXR8Z5jd",
      label: "Books",
    };

    expect(v.safeParse(entry, [base]).success).toBe(true);
    expect(
      v.safeParse(entry, [
        {
          ...base,
          bindings: {
            "citation.references-style": "apa",
            "note.import-folder": "Imported",
            "note.import-colored-highlights": true,
            "note.import-annotations-as-template": true,
          },
        },
      ]).success,
    ).toBe(true);
    expect(
      v.safeParse(entry, [
        {
          ...base,
          bindings: { "citation.references-style": null },
        },
      ]).success,
    ).toBe(true);
    expect(v.safeParse(entry, [{ ...base, label: "   " }]).success).toBe(false);
    expect(
      v.safeParse(entry, [
        {
          ...base,
          bindings: { "note.literature-folder": 42 },
        },
      ]).success,
    ).toBe(false);
  });
});
