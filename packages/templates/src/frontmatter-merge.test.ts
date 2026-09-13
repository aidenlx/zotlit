import { describe, expect, it } from "vitest";

import { mergeFrontmatterFields } from "./frontmatter-merge";

describe("mergeFrontmatterFields", () => {
  it("replaces values wholesale", () => {
    expect(
      mergeFrontmatterFields(
        [{ key: "title", merge: "replace" }],
        { title: { text: "New" } },
        { current: { title: ["Old"] } },
      ),
    ).toEqual({ title: { text: "New" } });
  });

  it("skips fields absent from evaluated values", () => {
    expect(
      mergeFrontmatterFields(
        [
          { key: "title", merge: "replace" },
          { key: "tags", merge: "append" },
          { key: "alias", merge: "keep" },
        ],
        {},
        { current: { title: "Old", tags: ["read"], alias: "A" } },
      ),
    ).toEqual({});
  });

  it("ignores evaluated keys absent from the field list", () => {
    expect(
      mergeFrontmatterFields(
        [{ key: "title", merge: "replace" }],
        { title: "New", removed: "stale" },
        { current: { title: "Old", removed: "manual" } },
      ),
    ).toEqual({ title: "New" });
  });

  it("uses an empty current record by default", () => {
    expect(
      mergeFrontmatterFields([{ key: "title", merge: "keep" }], {
        title: "New",
      }),
    ).toEqual({ title: "New" });
  });

  it("appends arrays with strict identity de-duplication", () => {
    const shared = { key: "A" };
    const equivalent = { key: "A" };
    expect(
      mergeFrontmatterFields(
        [{ key: "related", merge: "append" }],
        { related: ["old", "new", "new", shared, equivalent] },
        { current: { related: ["old", "old", shared] } },
      ),
    ).toEqual({
      related: ["old", "old", shared, "new", equivalent],
    });
  });

  it("emits append array patches even when unchanged", () => {
    expect(
      mergeFrontmatterFields(
        [{ key: "tags", merge: "append" }],
        { tags: ["read"] },
        { current: { tags: ["read"] } },
      ),
    ).toEqual({ tags: ["read"] });
  });

  it("replaces blank append targets", () => {
    const fields = [{ key: "value", merge: "append" }] as const;
    for (const current of [undefined, null, "", [], {}, Object.create(null)]) {
      expect(
        mergeFrontmatterFields(
          fields,
          { value: "new" },
          {
            current: { value: current },
          },
        ),
      ).toEqual({ value: "new" });
    }
  });

  it("preserves meaningful append targets and reports a conflict", () => {
    const conflicts: string[] = [];
    const patch = mergeFrontmatterFields(
      [{ key: "tags", merge: "append" }],
      { tags: ["new"] },
      {
        current: { tags: "manual" },
        onConflict: (key, detail) => conflicts.push(`${key}:${detail.reason}`),
      },
    );

    expect(patch).toEqual({});
    expect(conflicts).toEqual(["tags:shape-mismatch"]);
  });

  it("reports append conflicts with structured detail", () => {
    const conflicts: unknown[] = [];
    mergeFrontmatterFields(
      [{ key: "tags", merge: "append" }],
      { tags: ["new"] },
      {
        current: { tags: false },
        onConflict: (key, detail) => conflicts.push({ key, detail }),
      },
    );

    expect(conflicts).toEqual([
      {
        key: "tags",
        detail: { reason: "shape-mismatch" },
      },
    ]);
  });

  it("keeps meaningful values and overwrites blanks", () => {
    const fields = [
      { key: "a", merge: "keep" },
      { key: "b", merge: "keep" },
      { key: "c", merge: "keep" },
      { key: "d", merge: "keep" },
    ] as const;

    expect(
      mergeFrontmatterFields(
        fields,
        { a: "new", b: "new", c: "new", d: "new" },
        { current: { a: null, b: "", c: [], d: {} } },
      ),
    ).toEqual({ a: "new", b: "new", c: "new", d: "new" });

    expect(
      mergeFrontmatterFields(
        fields,
        { a: "new", b: "new", c: "new", d: "new" },
        { current: { a: 0, b: false, c: " ", d: [null] } },
      ),
    ).toEqual({});
  });

  it("never warns for keep fields", () => {
    const conflicts: string[] = [];
    const patch = mergeFrontmatterFields(
      [{ key: "title", merge: "keep" }],
      { title: "Generated" },
      {
        current: { title: "Manual" },
        onConflict: (key) => conflicts.push(key),
      },
    );

    expect(patch).toEqual({});
    expect(conflicts).toEqual([]);
  });

  it("treats NaN and non-empty objects as meaningful", () => {
    expect(
      mergeFrontmatterFields(
        [
          { key: "score", merge: "keep" },
          { key: "meta", merge: "keep" },
        ],
        { score: 1, meta: "new" },
        { current: { score: Number.NaN, meta: { source: "manual" } } },
      ),
    ).toEqual({});
  });

  it("treats non-plain empty objects as meaningful", () => {
    expect(
      mergeFrontmatterFields(
        [{ key: "date", merge: "keep" }],
        { date: "new" },
        { current: { date: new Date(0) } },
      ),
    ).toEqual({});
  });
});
