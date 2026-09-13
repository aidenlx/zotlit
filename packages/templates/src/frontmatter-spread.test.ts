// Spread entries through document validation, evaluation, and the frontmatter fold.

import { describe, expect, it } from "vitest";
import { stringify } from "yaml";

import { TemplateFacade } from "./facade";
import {
  evalManagedFrontmatterEntries,
  stringifyFrontmatterInOrder,
} from "./frontmatter";
import {
  FRONTMATTER_ABSENT,
  mergeManagedFrontmatterEntries,
} from "./frontmatter-merge";
import type { FrontmatterMergeConflict } from "./frontmatter-merge";

const timestamp = Temporal.Instant.from("2026-08-31T01:02:03Z");

function render(
  entries: readonly unknown[],
  options: {
    zt?: object;
    current?: Record<string, unknown>;
    javascript?: boolean;
  } = {},
) {
  const facade = new TemplateFacade();
  const document = facade.parseLiteratureNoteTemplate(
    `---\n${stringify({
      id: "spread-test",
      name: "Spread test",
      version: "1.0.0",
      contract: 2,
      filename: "note",
      frontmatter: entries,
    })}---\n--- zotlit:annotation ---\nAnnotation`,
  );
  const compiled = facade.compileManagedFrontmatterEntries(
    document.manifest.frontmatter!,
    { javascript: options.javascript ?? false },
  );
  const evaluation = evalManagedFrontmatterEntries(
    compiled.compiled,
    options.zt ?? {},
    timestamp,
  );
  const current = options.current ?? {};
  const conflicts: { key: string; detail: FrontmatterMergeConflict }[] = [];
  const patch = mergeManagedFrontmatterEntries(evaluation.values, {
    current,
    onConflict: (key, detail) => conflicts.push({ key, detail }),
  });
  const merged = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === FRONTMATTER_ABSENT) delete merged[key];
    else
      Object.defineProperty(merged, key, {
        value,
        enumerable: true,
        configurable: true,
        writable: true,
      });
  }
  const keys = [...Object.keys(current), ...evaluation.keys];
  return {
    merged,
    yaml: stringifyFrontmatterInOrder(merged, keys),
    errors: evaluation.errors,
    inertKeys: compiled.inertKeys,
    conflicts,
  };
}

describe("Spread entries", () => {
  it("sets a key's position when a value is first produced", () => {
    for (const initial of [
      { key: "later", expr: "zt.missing" },
      { key: "later", value: { $if: "false" } },
    ]) {
      expect(render([initial, { value: { first: 1, later: 2 } }]).yaml).toBe(
        "first: 1\nlater: 2\n",
      );
    }
  });
  it("folds overrides, append, and keep without moving a key's first position", () => {
    const entries = [
      { value: { title: "Default", tags: ["base"], kept: "first" } },
      { key: "title", value: "Override" },
      { key: "tags", merge: "append", value: ["base", "later"] },
      { merge: "keep", value: { kept: "second", new: "added" } },
    ];
    const created = render(entries);
    expect(created.errors).toEqual([]);
    expect(created.yaml).toBe(
      "title: Override\ntags:\n  - base\n  - later\nkept: first\nnew: added\n",
    );
    const current = { manual: "mine", kept: "old", title: "Old" };
    const updated = render(entries, { current });
    expect(updated.yaml).toBe(
      "manual: mine\nkept: first\ntitle: Override\ntags:\n  - base\n  - later\nnew: added\n",
    );
    expect(current).toEqual({ manual: "mine", kept: "old", title: "Old" });
  });

  it("preserves omitted spread keys while a static absent field deletes pending values", () => {
    const result = render(
      [
        {
          value: {
            removed: "pending",
            preserved: { $if: "false" },
            added: true,
          },
        },
        { value: { $if: "false" } },
        { key: "removed", value: { $if: "false" } },
        { value: { removed: "restored" }, merge: "keep" },
        { key: "deleted", value: { $if: "false" } },
      ],
      { current: { preserved: "mine", deleted: "old", unrelated: 42 } },
    );
    expect(result.errors).toEqual([]);
    expect(result.merged).toEqual({
      preserved: "mine",
      unrelated: 42,
      removed: "restored",
      added: true,
    });
    expect(
      render([
        { value: { pending: "new", retained: true } },
        { key: "pending", value: { $if: "false" } },
      ]).merged,
    ).toEqual({ retained: true });
  });

  it.each(["text", [], 42, true, null])(
    "refuses a non-mapping result %j by list position",
    (value) => {
      const result = render([{ key: "earlier", value: true }, { value }], {
        current: { untouched: true },
      });
      expect(result.errors).toEqual([
        expect.objectContaining({
          key: "entry #2",
          error: expect.objectContaining({
            message: expect.stringContaining("entry #2"),
            recovery: expect.any(String),
          }),
        }),
      ]);
    },
  );

  it.each(["zotero-key", "zotlit-profile", ""])(
    "identifies the produced invalid key '%s' and its entry position",
    (key) => {
      const result = render(
        [
          { key: "earlier", value: true },
          { value: { "${zt.key}": "bad", safe: "also refused" } },
        ],
        { zt: { key }, current: { untouched: true } },
      );
      expect(result.errors[0]?.key).toBe(`'${key}' (entry #2)`);
      expect(result.errors[0]?.error).toMatchObject({
        message: expect.stringContaining(`field '${key}' (entry #2)`),
        recovery: expect.any(String),
      });
    },
  );

  it.each([
    [[{ expr: "zt.title" }], "#1"],
    [
      [
        { key: "title", value: 1 },
        { key: "title", expr: "zt.title" },
      ],
      "Duplicate Managed Frontmatter key 'title'",
    ],
    [[{ key: "zotero-key", value: "bad" }], "key 'zotero-key' is reserved"],
  ])("rejects invalid document entries %j", (entries, diagnostic) => {
    expect(() => render(entries)).toThrowError(
      expect.objectContaining({
        code: "invalid-manifest",
        message: expect.stringContaining(diagnostic),
        recovery: expect.any(String),
      }),
    );
  });

  it("spreads gated JavaScript records and names inert entries by position", () => {
    const entries = [
      { key: "first", value: 1 },
      { js: '({ title: zt.title, tags: ["script"] })' },
    ];
    expect(
      render(entries, { zt: { title: "A Study" }, javascript: true }).merged,
    ).toEqual({ first: 1, title: "A Study", tags: ["script"] });
    const inert = render(entries, { current: { manual: true } });
    expect(inert.inertKeys).toEqual(["entry #2"]);
    expect(render([{ js: "1 +" }]).inertKeys).toEqual(["entry #1"]);
  });

  it.each([
    { value: { invalid: { $eval: "zt.infinity" } } },
    { js: "({ invalid: undefined })" },
    { js: "({ invalid: Symbol() })" },
    { js: "({ invalid: () => 1 })" },
    { js: "({ get invalid() { return 1; } })" },
  ])(
    "refuses output-domain violations with the key and entry position: %j",
    (entry) => {
      const result = render([{ value: { earlier: true } }, entry], {
        zt: { infinity: Infinity },
        javascript: true,
        current: { manual: true },
      });
      expect(result.errors[0]?.key).toBe("'invalid' (entry #2)");
      expect(result.errors[0]?.error).toMatchObject({
        message: expect.stringContaining("field 'invalid' (entry #2)"),
        recovery: expect.any(String),
      });
    },
  );

  it.each([
    { value: { tags: ["extra"] }, merge: "append" },
    { key: "tags", value: ["extra"], merge: "append" },
  ])("identifies append conflict %j and supplies a recovery hint", (entry) => {
    const result = render([{ value: { tags: "seed" } }, entry]);
    expect(result.merged).toEqual({ tags: "seed" });
    expect(result.conflicts).toEqual([
      {
        key: "tags",
        detail: {
          reason: "shape-mismatch",
          position: 2,
          recovery: "Use arrays for field 'tags' in entry #2, or use replace.",
        },
      },
    ]);
  });

  it.each(["1 +", "(() => { throw new Error('broken'); })()"])(
    "wraps JavaScript failure %s with its position and recovery",
    (js) => {
      const result = render([{ value: {} }, { js }], { javascript: true });
      expect(result.errors[0]).toMatchObject({
        key: "entry #2",
        error: {
          message: expect.stringContaining("entry #2"),
          recovery: expect.any(String),
        },
      });
    },
  );

  it("shares one computation across fields and computes a key name", () => {
    const result = render(
      [
        {
          value: {
            $let: {
              paths: {
                $flatten: {
                  $map: { $eval: "zt.collections" },
                  "each(c)": { $eval: "c.path" },
                },
              },
            },
            in: {
              collections: { $eval: "uniq(paths)" },
              count: { $eval: "len(paths)" },
              "zotero/${zt.itemType}": true,
              rendered: { $eval: "now" },
            },
          },
        },
      ],
      {
        zt: {
          collections: [{ path: ["Top", "Sub"] }, { path: ["Top", "Other"] }],
          itemType: "book",
        },
      },
    );

    expect(result.errors).toEqual([]);
    expect(result.merged).toEqual({
      collections: ["Top", "Sub", "Other"],
      count: 4,
      "zotero/book": true,
      rendered: "2026-08-31T01:02:03Z",
    });
  });
});
