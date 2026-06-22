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
      { key: " title ", expr: " zt.title ", merge: "replace" },
    ]);

    expect(result.success).toBe(true);
    expect(result.output).toEqual([
      { key: "title", expr: "zt.title", merge: "replace" },
    ]);

    expect(
      v.safeParse(entry, [
        { key: "title", expr: "zt.title", merge: "replace" },
        { key: "title", expr: "zt.shortTitle", merge: "keep" },
      ]).success,
    ).toBe(false);
  });

  it("requires frontmatter merge strategy", () => {
    expect(
      v.safeParse(schema.entries["note.frontmatter-fields"], [
        { key: "title", expr: "zt.title" },
      ]).success,
    ).toBe(false);
  });
});
