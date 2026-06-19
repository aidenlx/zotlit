import { describe, expect, it } from "vitest";

import {
  compileFrontmatterFields,
  evalFrontmatterFields,
  type FrontmatterField,
} from "./frontmatter";

const evalFields = (
  fields: readonly FrontmatterField[],
  zt: object,
  onError?: (key: string, error: unknown) => void,
): Record<string, unknown> =>
  evalFrontmatterFields(compileFrontmatterFields(fields), zt, onError);

describe("evalFrontmatterFields", () => {
  it("evaluates each field into a record, preserving value types", () => {
    const fm = evalFields(
      [
        { key: "title", expr: "zt.title" },
        { key: "year", expr: "zt.year" },
        { key: "tags", expr: "zt.tags" },
      ],
      { title: "A Study", year: 2024, tags: ["a", "b"] },
    );
    expect(fm).toEqual({ title: "A Study", year: 2024, tags: ["a", "b"] });
  });

  it("skips empty keys", () => {
    const fm = evalFields([{ key: "", expr: "'y'" }], {});
    expect(fm).toEqual({});
  });

  it("skips a failing expression and reports it", () => {
    const errors: string[] = [];
    const fm = evalFields([{ key: "boom", expr: "zt.nope.deep" }], {}, (key) =>
      errors.push(key),
    );
    expect("boom" in fm).toBe(false);
    expect(errors).toEqual(["boom"]);
  });

  it("reports a syntactically invalid expression at eval time", () => {
    const errors: string[] = [];
    const fm = evalFields([{ key: "bad", expr: "1 +" }], {}, (key) =>
      errors.push(key),
    );
    expect("bad" in fm).toBe(false);
    expect(errors).toEqual(["bad"]);
  });

  it("compiles each field once for reuse across evaluations", () => {
    const compiled = compileFrontmatterFields([
      { key: "title", expr: "zt.title" },
    ]);
    expect(evalFrontmatterFields(compiled, { title: "First" })).toEqual({
      title: "First",
    });
    expect(evalFrontmatterFields(compiled, { title: "Second" })).toEqual({
      title: "Second",
    });
  });
});
