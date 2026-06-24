import { describe, expect, it } from "vitest";

import { type NoteTemplateContext } from "@zotlit/db";
import {
  compileFrontmatterFields,
  type FrontmatterField,
} from "@zotlit/templates/frontmatter";

import {
  FIELD_ATTACHMENTS,
  FIELD_CITEKEY,
  FIELD_ZOTERO_KEY,
  RESERVED_KEYS,
} from "@/lib/constants";

import { DEFAULT_FRONTMATTER_FIELDS } from "./defaults";
import { applyManagedFrontmatter } from "./frontmatter";

/** Mirror the production compile (TemplateService): drop reserved keys, then
 *  compile — applyManagedFrontmatter only ever receives pre-filtered fields. */
function compileFrontmatter(fields: readonly FrontmatterField[]) {
  return compileFrontmatterFields(
    fields.filter((field) => !RESERVED_KEYS.has(field.key)),
  );
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
  it("writes system fields and evaluated user expressions", () => {
    const fm: Record<string, unknown> = {};
    applyManagedFrontmatter(fm, makeContext(), {
      compiled: compileFrontmatter([
        { key: "title", expr: "zt.title", merge: "replace" },
      ]),
    });
    expect(fm).toEqual({
      [FIELD_ZOTERO_KEY]: "ABC12345",
      [FIELD_CITEKEY]: "smith2024",
      title: "A Study",
    });
  });

  it("omits citekey when the item has none", () => {
    const fm: Record<string, unknown> = { [FIELD_CITEKEY]: "old" };
    applyManagedFrontmatter(fm, makeContext({ citationKey: null }), {
      compiled: compileFrontmatter([]),
    });
    expect(fm).toEqual({ [FIELD_ZOTERO_KEY]: "ABC12345" });
  });

  it("skips reserved keys", () => {
    const fm: Record<string, unknown> = {};
    applyManagedFrontmatter(fm, makeContext(), {
      compiled: compileFrontmatter([
        { key: FIELD_ZOTERO_KEY, expr: "'x'", merge: "replace" },
        { key: "year", expr: "2024", merge: "replace" },
      ]),
    });
    expect(fm).toEqual({
      [FIELD_ZOTERO_KEY]: "ABC12345",
      [FIELD_CITEKEY]: "smith2024",
      year: 2024,
    });
  });

  it("writes zt-attachments only when a non-empty scope is given", () => {
    const scoped: Record<string, unknown> = {};
    applyManagedFrontmatter(scoped, makeContext(), {
      compiled: compileFrontmatter([]),
      attachmentScope: ["ATCH1", "ATCH2"],
    });
    expect(scoped[FIELD_ATTACHMENTS]).toEqual(["ATCH1", "ATCH2"]);

    const unscoped: Record<string, unknown> = {
      [FIELD_ATTACHMENTS]: ["OLD"],
    };
    applyManagedFrontmatter(unscoped, makeContext(), {
      compiled: compileFrontmatter([]),
      attachmentScope: [],
    });
    expect(FIELD_ATTACHMENTS in unscoped).toBe(false);
  });

  it("writes default related item note links as an array", () => {
    const fm: Record<string, unknown> = {};
    applyManagedFrontmatter(
      fm,
      makeContext({
        relatedItems: [
          { noteLink: () => "[[Related A]]" },
          { noteLink: () => "" },
          { noteLink: () => "[[Related B]]" },
        ],
      } as Partial<NoteTemplateContext>),
      {
        compiled: compileFrontmatter(DEFAULT_FRONTMATTER_FIELDS),
      },
    );

    expect(fm.related).toEqual(["[[Related A]]", "[[Related B]]"]);
  });

  it("replaces default related links from Zotero data", () => {
    const fm: Record<string, unknown> = { related: ["[[Manual]]"] };
    applyManagedFrontmatter(
      fm,
      makeContext({
        relatedItems: [{ noteLink: () => "[[Related A]]" }],
      } as Partial<NoteTemplateContext>),
      {
        compiled: compileFrontmatter(DEFAULT_FRONTMATTER_FIELDS),
      },
    );

    expect(fm.related).toEqual(["[[Related A]]"]);
  });

  it("applies user field strategies against the target", () => {
    const fm = { aliases: ["old"], title: "Old" };

    applyManagedFrontmatter(fm, makeContext({ title: "New" }), {
      compiled: compileFrontmatter([
        { key: "title", expr: "zt.title", merge: "replace" },
        { key: "aliases", expr: "['new']", merge: "append" },
      ]),
    });

    expect(fm).toEqual({
      aliases: ["old", "new"],
      title: "New",
      [FIELD_CITEKEY]: "smith2024",
      [FIELD_ZOTERO_KEY]: "ABC12345",
    });
  });

  it("leaves existing values untouched when expressions return undefined", () => {
    const fm: Record<string, unknown> = { title: "Manual" };

    applyManagedFrontmatter(fm, makeContext(), {
      compiled: compileFrontmatter([
        { key: "title", expr: "undefined", merge: "replace" },
      ]),
    });

    expect(fm.title).toBe("Manual");
  });

  it("writes null user values", () => {
    const fm: Record<string, unknown> = { title: "Manual" };

    applyManagedFrontmatter(fm, makeContext(), {
      compiled: compileFrontmatter([
        { key: "title", expr: "null", merge: "replace" },
      ]),
    });

    expect(fm.title).toBe(null);
  });

  it("keeps meaningful existing values for keep fields", () => {
    const fm: Record<string, unknown> = { title: "Manual", aliases: [] };

    applyManagedFrontmatter(fm, makeContext(), {
      compiled: compileFrontmatter([
        { key: "title", expr: "zt.title", merge: "keep" },
        { key: "aliases", expr: "['generated']", merge: "keep" },
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
        { key: "title", expr: "zt.missing.deep", merge: "keep" },
      ]),
      onError: (key) => errors.push(key),
    });

    expect(fm.title).toBe("Manual");
    expect(errors).toEqual(["title"]);
  });

  it("reports append conflicts without changing existing values", () => {
    const conflicts: string[] = [];
    const fm: Record<string, unknown> = { tags: "manual" };

    applyManagedFrontmatter(fm, makeContext(), {
      compiled: compileFrontmatter([
        { key: "tags", expr: "['generated']", merge: "append" },
      ]),
      onConflict: (key, detail) => conflicts.push(`${key}:${detail.reason}`),
    });

    expect(fm.tags).toBe("manual");
    expect(conflicts).toEqual(["tags:shape-mismatch"]);
  });
});
