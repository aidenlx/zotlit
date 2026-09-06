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

  it("keeps Profile Selection Rules ordered, identified, and portable", () => {
    const entry = schema.entries["profile.selection-rules"];
    const rules = [
      {
        id: "r1",
        filter: 'itemType == "book"',
        profile: "Bk3Qn7XvT2Lp",
      },
      {
        id: "r2",
        filter: 'library == "group:118"',
        profile: "default",
      },
    ];
    expect(v.safeParse(entry, rules)).toMatchObject({
      success: true,
      output: rules,
    });
    expect(
      v.safeParse(entry, [rules[0], { ...rules[1], id: "r1" }]).success,
    ).toBe(false);
    expect(
      v.safeParse(entry, [{ ...rules[0], profile: "not-a-profile" }]).success,
    ).toBe(false);
    // Rules carry Library conditions inside the filter; the schema has no scope field.
    const parsed = v.parse(entry, [{ ...rules[0], scope: { mode: "all" } }]);
    expect(parsed[0]).not.toHaveProperty("scope");
    expect(defaults["profile.selection-rules"]).toEqual([]);
  });

  it("keeps Profile documents and Pack records out of settings", () => {
    expect(schema.entries).not.toHaveProperty("note.profiles");
    expect(schema.entries).not.toHaveProperty("note.template-pack-installs");
    expect(
      v.parse(schema.entries["note.default-profile"], {
        ...defaults["note.default-profile"],
        document: "old.md",
      }),
    ).not.toHaveProperty("document");
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
});
