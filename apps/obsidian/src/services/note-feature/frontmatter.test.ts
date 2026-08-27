import { describe, expect, it } from "vitest";

import type { NoteTemplateContext } from "@zotlit/db";
import { compileFrontmatterFields } from "@zotlit/templates/frontmatter";
import type { FrontmatterField } from "@zotlit/templates/frontmatter";
import { createLiquidEngine } from "@zotlit/templates/liquid";

import {
  FIELD_CITEKEY,
  FIELD_LITERATURE_NOTE_PROFILE,
  FIELD_ZOTERO_KEY,
  RESERVED_KEYS,
} from "@/lib/constants";
import { DEFAULT_FRONTMATTER_FIELDS } from "@/services/template/defaults";

import { applyManagedFrontmatter } from "./frontmatter";

/** Mirror the production compile (TemplateService): drop reserved keys, then
 *  compile against the shared Liquid vocabulary — applyManagedFrontmatter only
 *  ever receives pre-filtered fields. Defaults to the gate on since most
 *  fixtures below are javascript-language, matching their pre-ticket-06 shape. */
function compileFrontmatter(
  fields: readonly FrontmatterField[],
  options: { javascript?: boolean } = {},
) {
  return compileFrontmatterFields(
    fields.filter((field) => !RESERVED_KEYS.has(field.key)),
    { liquid: createLiquidEngine(), javascript: options.javascript ?? true },
  ).compiled;
}

function makeContext(
  overrides: Partial<NoteTemplateContext> = {},
): NoteTemplateContext {
  return {
    indexedKey: "ABC12345",
    citationKey: "smith2024",
    title: "A Study",
    collections: [],
    ...overrides,
  } as NoteTemplateContext;
}

describe("applyManagedFrontmatter", () => {
  it("writes the system item key and evaluated user expressions", () => {
    const fm: Record<string, unknown> = {};
    applyManagedFrontmatter(fm, makeContext(), {
      compiled: compileFrontmatter([
        {
          key: "title",
          expr: "zt.title",
          merge: "replace",
          language: "javascript",
        },
      ]),
    });
    expect(fm).toEqual({
      [FIELD_ZOTERO_KEY]: "ABC12345",
      title: "A Study",
    });
  });

  it("writes a configured citekey field as null when the item has none", () => {
    const fm: Record<string, unknown> = { [FIELD_CITEKEY]: "old" };
    applyManagedFrontmatter(fm, makeContext({ citationKey: null }), {
      compiled: compileFrontmatter([
        {
          key: FIELD_CITEKEY,
          expr: "zt.citationKey",
          merge: "replace",
          language: "liquid",
        },
      ]),
    });
    expect(fm).toEqual({
      [FIELD_CITEKEY]: null,
      [FIELD_ZOTERO_KEY]: "ABC12345",
    });
  });

  it("skips reserved keys", () => {
    const fm: Record<string, unknown> = {};
    applyManagedFrontmatter(fm, makeContext(), {
      compiled: compileFrontmatter([
        {
          key: FIELD_ZOTERO_KEY,
          expr: "'x'",
          merge: "replace",
          language: "javascript",
        },
        {
          key: FIELD_LITERATURE_NOTE_PROFILE,
          expr: "'user-profile'",
          merge: "replace",
          language: "javascript",
        },
        { key: "year", expr: "2024", merge: "replace", language: "javascript" },
      ]),
    });
    expect(fm).toEqual({
      [FIELD_ZOTERO_KEY]: "ABC12345",
      year: 2024,
    });
  });

  it("writes default related item note links as an array, with the gate off", () => {
    const fm: Record<string, unknown> = {};
    applyManagedFrontmatter(
      fm,
      makeContext({
        relatedItems: [
          { indexedKey: "A1", noteLink: () => "[[Related A]]" },
          { indexedKey: "B2", noteLink: () => null },
          { indexedKey: "C3", noteLink: () => "[[Related B]]" },
        ],
      } as Partial<NoteTemplateContext>),
      {
        compiled: compileFrontmatter(DEFAULT_FRONTMATTER_FIELDS, {
          javascript: false,
        }),
      },
    );

    expect(fm.related).toEqual([
      "[[Related A]]",
      "zt-error:B2",
      "[[Related B]]",
    ]);
  });

  it("replaces default related links from Zotero data, with the gate off", () => {
    const fm: Record<string, unknown> = { related: ["[[Manual]]"] };
    applyManagedFrontmatter(
      fm,
      makeContext({
        relatedItems: [{ noteLink: () => "[[Related A]]" }],
      } as Partial<NoteTemplateContext>),
      {
        compiled: compileFrontmatter(DEFAULT_FRONTMATTER_FIELDS, {
          javascript: false,
        }),
      },
    );

    expect(fm.related).toEqual(["[[Related A]]"]);
  });

  it("writes the default title field verbatim, with the gate off", () => {
    const fm: Record<string, unknown> = {};
    applyManagedFrontmatter(fm, makeContext({ title: "A Study" }), {
      compiled: compileFrontmatter(DEFAULT_FRONTMATTER_FIELDS, {
        javascript: false,
      }),
    });

    expect(fm.title).toBe("A Study");
  });

  it("joins the default collections field into paths, with the gate off", () => {
    const fm: Record<string, unknown> = {};
    applyManagedFrontmatter(
      fm,
      makeContext({
        collections: [
          { key: "C1", name: "Sub", path: ["Top", "Sub"] },
          { key: "C2", name: "Other", path: ["Other"] },
        ],
      }),
      {
        compiled: compileFrontmatter(DEFAULT_FRONTMATTER_FIELDS, {
          javascript: false,
        }),
      },
    );

    expect(fm.collections).toEqual(["Top/Sub", "Other"]);
  });

  it("returns intact typed values (arrays, numbers) from a liquid field", () => {
    const fm: Record<string, unknown> = {};
    applyManagedFrontmatter(
      fm,
      makeContext({
        customList: ["a", "b"],
        customYear: 2024,
      } as Partial<NoteTemplateContext>),
      {
        compiled: compileFrontmatter(
          [
            {
              key: "list",
              expr: "zt.customList",
              merge: "replace",
              language: "liquid",
            },
            {
              key: "year",
              expr: "zt.customYear",
              merge: "replace",
              language: "liquid",
            },
          ],
          { javascript: false },
        ),
      },
    );

    expect(fm.list).toEqual(["a", "b"]);
    expect(fm.year).toBe(2024);
  });

  it("evaluates a javascript field when the gate is on, and leaves it inert (existing key untouched) when the gate is off", () => {
    const field = {
      key: "computed",
      expr: "zt.title + '!'",
      merge: "replace",
      language: "javascript",
    } as const;

    const fmOn: Record<string, unknown> = {};
    applyManagedFrontmatter(fmOn, makeContext(), {
      compiled: compileFrontmatter([field], { javascript: true }),
    });
    expect(fmOn.computed).toBe("A Study!");

    const fmOff: Record<string, unknown> = { computed: "existing" };
    applyManagedFrontmatter(fmOff, makeContext(), {
      compiled: compileFrontmatter([field], { javascript: false }),
    });
    expect(fmOff.computed).toBe("existing");
  });

  it("applies user field strategies against the target", () => {
    const fm = { aliases: ["old"], title: "Old" };

    applyManagedFrontmatter(fm, makeContext({ title: "New" }), {
      compiled: compileFrontmatter([
        {
          key: "title",
          expr: "zt.title",
          merge: "replace",
          language: "javascript",
        },
        {
          key: "aliases",
          expr: "['new']",
          merge: "append",
          language: "javascript",
        },
      ]),
    });

    expect(fm).toEqual({
      aliases: ["old", "new"],
      title: "New",
      [FIELD_ZOTERO_KEY]: "ABC12345",
    });
  });

  it("leaves existing values untouched when expressions return undefined", () => {
    const fm: Record<string, unknown> = { title: "Manual" };

    applyManagedFrontmatter(fm, makeContext(), {
      compiled: compileFrontmatter([
        {
          key: "title",
          expr: "undefined",
          merge: "replace",
          language: "javascript",
        },
      ]),
    });

    expect(fm.title).toBe("Manual");
  });

  it("writes null user values", () => {
    const fm: Record<string, unknown> = { title: "Manual" };

    applyManagedFrontmatter(fm, makeContext(), {
      compiled: compileFrontmatter([
        {
          key: "title",
          expr: "null",
          merge: "replace",
          language: "javascript",
        },
      ]),
    });

    expect(fm.title).toBe(null);
  });

  it("keeps meaningful existing values for keep fields", () => {
    const fm: Record<string, unknown> = { title: "Manual", aliases: [] };

    applyManagedFrontmatter(fm, makeContext(), {
      compiled: compileFrontmatter([
        {
          key: "title",
          expr: "zt.title",
          merge: "keep",
          language: "javascript",
        },
        {
          key: "aliases",
          expr: "['generated']",
          merge: "keep",
          language: "javascript",
        },
      ]),
    });

    expect(fm.title).toBe("Manual");
    expect(fm.aliases).toEqual(["generated"]);
  });

  it("reports keep field expression errors even when the target has a value", () => {
    const errors: string[] = [];
    const fm: Record<string, unknown> = { title: "Manual" };

    applyManagedFrontmatter(fm, makeContext(), {
      compiled: compileFrontmatter([
        {
          key: "title",
          expr: "zt.missing.deep",
          merge: "keep",
          language: "javascript",
        },
      ]),
      onError: (key) => errors.push(key),
    });

    expect(fm.title).toBe("Manual");
    expect(errors).toEqual(["title"]);
  });

  it("skips a field whose expression throws at runtime, without aborting sibling fields", () => {
    const errors: string[] = [];
    const fm: Record<string, unknown> = {};

    applyManagedFrontmatter(fm, makeContext(), {
      compiled: compileFrontmatter([
        {
          key: "broken",
          expr: "zt.missing.deep",
          merge: "replace",
          language: "javascript",
        },
        {
          key: "title",
          expr: "zt.title",
          merge: "replace",
          language: "javascript",
        },
      ]),
      onError: (key) => errors.push(key),
    });

    expect(errors).toEqual(["broken"]);
    expect(fm.title).toBe("A Study");
    expect("broken" in fm).toBe(false);
  });

  it("reports append conflicts without changing existing values", () => {
    const conflicts: string[] = [];
    const fm: Record<string, unknown> = { tags: "manual" };

    applyManagedFrontmatter(fm, makeContext(), {
      compiled: compileFrontmatter([
        {
          key: "tags",
          expr: "['generated']",
          merge: "append",
          language: "javascript",
        },
      ]),
      onConflict: (key, detail) => conflicts.push(`${key}:${detail.reason}`),
    });

    expect(fm.tags).toBe("manual");
    expect(conflicts).toEqual(["tags:shape-mismatch"]);
  });
});
