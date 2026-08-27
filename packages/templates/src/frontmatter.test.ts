import { describe, expect, it } from "vitest";

import {
  compileFrontmatterFields,
  compileManagedFrontmatterEntries,
  evalFrontmatterFields,
  evalManagedFrontmatterEntries,
} from "./frontmatter";
import type { FrontmatterField } from "./frontmatter";
import { createLiquidEngine } from "./liquid";
import type { ManagedFrontmatterEntry } from "./literature-note-template";

function evalFields(
  fields: readonly FrontmatterField[],
  zt: object,
  options: {
    javascript?: boolean;
    onError?: (key: string, error: unknown) => void;
  } = {},
): Record<string, unknown> {
  const { compiled } = compileFrontmatterFields(fields, {
    liquid: createLiquidEngine(),
    javascript: options.javascript ?? true,
  });
  return evalFrontmatterFields(compiled, zt, options.onError);
}

describe("evalFrontmatterFields (javascript fields)", () => {
  it("evaluates each field into a record, preserving value types", () => {
    const fm = evalFields(
      [
        {
          key: "title",
          expr: "zt.title",
          merge: "replace",
          language: "javascript",
        },
        {
          key: "year",
          expr: "zt.year",
          merge: "replace",
          language: "javascript",
        },
        {
          key: "tags",
          expr: "zt.tags",
          merge: "replace",
          language: "javascript",
        },
      ],
      { title: "A Study", year: 2024, tags: ["a", "b"] },
    );
    expect(fm).toEqual({ title: "A Study", year: 2024, tags: ["a", "b"] });
  });

  it("skips empty keys", () => {
    const fm = evalFields(
      [{ key: "", expr: "'y'", merge: "replace", language: "javascript" }],
      {},
    );
    expect(fm).toEqual({});
  });

  it("evaluates an expression ending in a line comment", () => {
    const fm = evalFields(
      [
        {
          key: "title",
          expr: "zt.title // primary",
          merge: "replace",
          language: "javascript",
        },
      ],
      { title: "A Study" },
    );
    expect(fm).toEqual({ title: "A Study" });
  });

  it("skips a failing expression and reports it", () => {
    const errors: string[] = [];
    const fm = evalFields(
      [
        {
          key: "boom",
          expr: "zt.nope.deep",
          merge: "replace",
          language: "javascript",
        },
      ],
      {},
      { onError: (key) => errors.push(key) },
    );
    expect("boom" in fm).toBe(false);
    expect(errors).toEqual(["boom"]);
  });

  it("reports a syntactically invalid expression at eval time", () => {
    const errors: string[] = [];
    const fm = evalFields(
      [{ key: "bad", expr: "1 +", merge: "replace", language: "javascript" }],
      {},
      { onError: (key) => errors.push(key) },
    );
    expect("bad" in fm).toBe(false);
    expect(errors).toEqual(["bad"]);
  });

  it("omits undefined values", () => {
    const fm = evalFields(
      [
        {
          key: "missing",
          expr: "undefined",
          merge: "replace",
          language: "javascript",
        },
      ],
      {},
    );
    expect(fm).toEqual({});
  });

  it("keeps null values", () => {
    const fm = evalFields(
      [
        {
          key: "empty",
          expr: "null",
          merge: "replace",
          language: "javascript",
        },
      ],
      {},
    );
    expect(fm).toEqual({ empty: null });
  });

  it("compiles each field once for reuse across evaluations", () => {
    const { compiled } = compileFrontmatterFields(
      [
        {
          key: "title",
          expr: "zt.title",
          merge: "replace",
          language: "javascript",
        },
      ],
      { liquid: createLiquidEngine(), javascript: true },
    );
    expect(evalFrontmatterFields(compiled, { title: "First" })).toEqual({
      title: "First",
    });
    expect(evalFrontmatterFields(compiled, { title: "Second" })).toEqual({
      title: "Second",
    });
  });

  it("carries merge strategy on compiled fields", () => {
    const { compiled } = compileFrontmatterFields(
      [
        {
          key: "tags",
          expr: "zt.tags",
          merge: "append",
          language: "javascript",
        },
      ],
      { liquid: createLiquidEngine(), javascript: true },
    );
    expect(compiled).toMatchObject([{ key: "tags", merge: "append" }]);
  });

  it("treats keys as literal top-level names", () => {
    const fm = evalFields(
      [
        {
          key: "zotero.related",
          expr: "'literal'",
          merge: "replace",
          language: "javascript",
        },
      ],
      {},
    );
    expect(fm).toEqual({ "zotero.related": "literal" });
  });

  it("injects basename into frontmatter expressions", () => {
    const fm = evalFields(
      [
        {
          key: "defaultExt",
          expr: "basename(zt.path)",
          merge: "replace",
          language: "javascript",
        },
        {
          key: "customExt",
          expr: "basename(zt.path, '.txt')",
          merge: "replace",
          language: "javascript",
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

describe("document Managed Frontmatter entries", () => {
  const operationTimestamp = Temporal.Instant.from("2026-08-28T01:02:03Z");

  function compile(
    entries: readonly ManagedFrontmatterEntry[],
    javascript = true,
  ) {
    return compileManagedFrontmatterEntries(entries, {
      liquid: createLiquidEngine(),
      javascript,
    });
  }

  it("evaluates expr, value, and js entries in order", () => {
    const result = evalManagedFrontmatterEntries(
      compile([
        { key: "title", merge: "replace", expr: "zt.title" },
        {
          key: "tags",
          merge: "append",
          value: { $eval: "zt.tags" },
        },
        { key: "label", merge: "keep", js: "zt.title + '!'" },
      ]).compiled,
      { title: "A Study", tags: ["paper"] },
      operationTimestamp,
    );

    expect(result).toEqual({
      values: { title: "A Study", tags: ["paper"], label: "A Study!" },
      errors: [],
    });
  });

  it("collects every field error without substitute values", () => {
    const result = evalManagedFrontmatterEntries(
      compile([
        { key: "broken-expr", merge: "replace", expr: "zt.title | flatten" },
        {
          key: "broken-value",
          merge: "replace",
          value: { $eval: "zt.infinity" },
        },
        { key: "working", merge: "replace", expr: "zt.title" },
      ]).compiled,
      { title: "A Study", infinity: Number.POSITIVE_INFINITY },
      operationTimestamp,
    );

    expect(result.values).toEqual({ working: "A Study" });
    expect(result.errors.map(({ key }) => key)).toEqual([
      "broken-expr",
      "broken-value",
    ]);
  });

  it("keeps js entries inert when JavaScript Templates are disabled", () => {
    const compiled = compile(
      [
        { key: "plain", merge: "replace", expr: "zt.title" },
        { key: "scripted", merge: "replace", js: "zt.title" },
      ],
      false,
    );

    expect(compiled.inertKeys).toEqual(["scripted"]);
    expect(compiled.compiled.map(({ key }) => key)).toEqual(["plain"]);
  });
});

describe("evalFrontmatterFields (liquid fields)", () => {
  it("returns a flattened unique collection-path list", () => {
    const fm = evalFields(
      [
        {
          key: "collections",
          expr: 'zt.collections | map: "path" | flatten | uniq',
          merge: "replace",
          language: "liquid",
        },
      ],
      {
        collections: [{ path: ["Top", "Sub"] }, { path: ["Top", "Other"] }],
      },
    );

    expect(fm).toEqual({ collections: ["Top", "Sub", "Other"] });
  });

  it("reports non-array flatten input against its field key", () => {
    const errors: { key: string; message: string }[] = [];
    const fm = evalFields(
      [
        {
          key: "collections",
          expr: "zt.collections | flatten",
          merge: "replace",
          language: "liquid",
        },
      ],
      { collections: null },
      {
        onError: (key, error) =>
          errors.push({
            key,
            message: error instanceof Error ? error.message : String(error),
          }),
      },
    );

    expect(fm).toEqual({});
    expect(errors).toEqual([
      { key: "collections", message: "flatten requires an array" },
    ]);
  });

  it("returns an intact array regardless of the javascript gate", () => {
    const zt = { tags: [{ name: "ai" }, { name: "nlp" }] };
    const fields: FrontmatterField[] = [
      {
        key: "tags",
        expr: "zt.tags | map: 'name'",
        merge: "replace",
        language: "liquid",
      },
    ];

    for (const javascript of [true, false]) {
      const fm = evalFields(fields, zt, { javascript });
      expect(fm.tags).toEqual(["ai", "nlp"]);
      expect(Array.isArray(fm.tags)).toBe(true);
    }
  });

  it("returns an intact number regardless of the javascript gate", () => {
    const zt = { year: 2024 };
    const fields: FrontmatterField[] = [
      { key: "year", expr: "zt.year", merge: "replace", language: "liquid" },
    ];

    for (const javascript of [true, false]) {
      const fm = evalFields(fields, zt, { javascript });
      expect(fm.year).toBe(2024);
      expect(typeof fm.year).toBe("number");
    }
  });

  it("does not throw on a liquid parse error; reports it per-field, siblings unaffected", () => {
    const errors: string[] = [];
    const fm = evalFields(
      [
        { key: "bad", expr: "1 +", merge: "replace", language: "liquid" },
        { key: "ok", expr: "zt.year", merge: "replace", language: "liquid" },
      ],
      { title: "A Study", year: 2024 },
      { onError: (key) => errors.push(key) },
    );
    expect("bad" in fm).toBe(false);
    expect(errors).toEqual(["bad"]);
    expect(fm.ok).toBe(2024);
  });

  it("reports a liquid runtime throw per-field, siblings unaffected", () => {
    const errors: string[] = [];
    const zt = {
      get boom(): never {
        throw new Error("kaboom");
      },
      year: 2024,
    };
    const fm = evalFields(
      [
        { key: "bad", expr: "zt.boom", merge: "replace", language: "liquid" },
        { key: "ok", expr: "zt.year", merge: "replace", language: "liquid" },
      ],
      zt,
      { onError: (key) => errors.push(key) },
    );
    expect("bad" in fm).toBe(false);
    expect(errors).toEqual(["bad"]);
    expect(fm.ok).toBe(2024);
  });

  it("omits undefined results (missing variable)", () => {
    const fm = evalFields(
      [
        {
          key: "missing",
          expr: "zt.nope",
          merge: "replace",
          language: "liquid",
        },
      ],
      {},
    );
    expect("missing" in fm).toBe(false);
  });

  it("filters javascript fields before compilation, so a js syntax error never throws while gate is off, and liquid fields still evaluate", () => {
    const { compiled, inertKeys } = compileFrontmatterFields(
      [
        {
          key: "broken",
          expr: "1 +",
          merge: "replace",
          language: "javascript",
        },
        {
          key: "title",
          expr: "zt.title",
          merge: "replace",
          language: "liquid",
        },
      ],
      { liquid: createLiquidEngine(), javascript: false },
    );

    expect(inertKeys).toEqual(["broken"]);
    expect(compiled.map((f) => f.key)).toEqual(["title"]);

    const fm = evalFrontmatterFields(compiled, { title: "A Study" });
    expect(fm).toEqual({ title: "A Study" });
  });

  it("compiles a liquid field once and reuses it correctly across different scopes", () => {
    const { compiled } = compileFrontmatterFields(
      [
        {
          key: "paths",
          expr: "zt.collections | collection_paths",
          merge: "replace",
          language: "liquid",
        },
      ],
      { liquid: createLiquidEngine(), javascript: true },
    );

    expect(
      evalFrontmatterFields(compiled, {
        collections: [{ path: ["Top", "Sub"] }],
      }),
    ).toEqual({ paths: ["Top/Sub"] });
    expect(
      evalFrontmatterFields(compiled, {
        collections: [{ path: ["Alt", "Deep", "Path"] }],
      }),
    ).toEqual({ paths: ["Alt/Deep/Path"] });
  });
});
