import { describe, expect, it } from "vitest";

import {
  compileFrontmatterFields,
  evalFrontmatterFields,
  type FrontmatterField,
} from "./frontmatter";

function evalFields(
  fields: readonly FrontmatterField[],
  zt: object,
  onError?: (key: string, error: unknown) => void,
): Record<string, unknown> {
  return evalFrontmatterFields(compileFrontmatterFields(fields), zt, onError);
}

describe("evalFrontmatterFields", () => {
  it("evaluates each field into a record, preserving value types", () => {
    const fm = evalFields(
      [
        { key: "title", expr: "zt.title", merge: "replace" },
        { key: "year", expr: "zt.year", merge: "replace" },
        { key: "tags", expr: "zt.tags", merge: "replace" },
      ],
      { title: "A Study", year: 2024, tags: ["a", "b"] },
    );
    expect(fm).toEqual({ title: "A Study", year: 2024, tags: ["a", "b"] });
  });

  it("skips empty keys", () => {
    const fm = evalFields([{ key: "", expr: "'y'", merge: "replace" }], {});
    expect(fm).toEqual({});
  });

  it("evaluates an expression ending in a line comment", () => {
    const fm = evalFields(
      [{ key: "title", expr: "zt.title // primary", merge: "replace" }],
      {
        title: "A Study",
      },
    );
    expect(fm).toEqual({ title: "A Study" });
  });

  it("skips a failing expression and reports it", () => {
    const errors: string[] = [];
    const fm = evalFields(
      [{ key: "boom", expr: "zt.nope.deep", merge: "replace" }],
      {},
      (key) => errors.push(key),
    );
    expect("boom" in fm).toBe(false);
    expect(errors).toEqual(["boom"]);
  });

  it("reports a syntactically invalid expression at eval time", () => {
    const errors: string[] = [];
    const fm = evalFields(
      [{ key: "bad", expr: "1 +", merge: "replace" }],
      {},
      (key) => errors.push(key),
    );
    expect("bad" in fm).toBe(false);
    expect(errors).toEqual(["bad"]);
  });

  it("omits undefined values", () => {
    const fm = evalFields(
      [{ key: "missing", expr: "undefined", merge: "replace" }],
      {},
    );
    expect(fm).toEqual({});
  });

  it("keeps null values", () => {
    const fm = evalFields(
      [{ key: "empty", expr: "null", merge: "replace" }],
      {},
    );
    expect(fm).toEqual({ empty: null });
  });

  it("compiles each field once for reuse across evaluations", () => {
    const compiled = compileFrontmatterFields([
      { key: "title", expr: "zt.title", merge: "replace" },
    ]);
    expect(evalFrontmatterFields(compiled, { title: "First" })).toEqual({
      title: "First",
    });
    expect(evalFrontmatterFields(compiled, { title: "Second" })).toEqual({
      title: "Second",
    });
  });

  it("carries merge strategy on compiled fields", () => {
    expect(
      compileFrontmatterFields([
        { key: "tags", expr: "zt.tags", merge: "append" },
      ]),
    ).toMatchObject([{ key: "tags", merge: "append" }]);
  });

  it("treats keys as literal top-level names", () => {
    const fm = evalFields(
      [{ key: "zotero.related", expr: "'literal'", merge: "replace" }],
      {},
    );
    expect(fm).toEqual({ "zotero.related": "literal" });
  });

  it("injects basename into frontmatter expressions", () => {
    const fm = evalFields(
      [
        { key: "defaultExt", expr: "basename(zt.path)", merge: "replace" },
        {
          key: "customExt",
          expr: "basename(zt.path, '.txt')",
          merge: "replace",
        },
      ],
      { path: "folder/Smith2024.md" },
    );

    expect(fm).toEqual({
      defaultExt: "Smith2024",
      customExt: "Smith2024.md",
    });
  });
});
