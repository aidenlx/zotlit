import { describe, expect, it } from "vitest";

import { type NoteTemplateContext } from "@zotlit/db";

import {
  FIELD_ATTACHMENTS,
  FIELD_CITEKEY,
  FIELD_ZOTERO_KEY,
} from "@/lib/constants";

import {
  buildFrontmatter,
  compileFrontmatter,
  mergeManagedFrontmatter,
} from "./frontmatter";

function makeContext(
  overrides: Partial<NoteTemplateContext> = {},
): NoteTemplateContext {
  return {
    indexedKey: "ABC12345",
    citationKey: "smith2024",
    title: "A Study",
    ...overrides,
  } as NoteTemplateContext;
}

describe("buildFrontmatter", () => {
  it("writes system fields and evaluated user expressions", () => {
    const fm = buildFrontmatter(makeContext(), {
      compiled: compileFrontmatter([{ key: "title", expr: "zt.title" }]),
    });
    expect(fm).toEqual({
      [FIELD_ZOTERO_KEY]: "ABC12345",
      [FIELD_CITEKEY]: "smith2024",
      title: "A Study",
    });
  });

  it("omits citekey when the item has none", () => {
    const fm = buildFrontmatter(makeContext({ citationKey: null }), {
      compiled: compileFrontmatter([]),
    });
    expect(fm).toEqual({ [FIELD_ZOTERO_KEY]: "ABC12345" });
  });

  it("skips reserved keys", () => {
    const fm = buildFrontmatter(makeContext(), {
      compiled: compileFrontmatter([
        { key: FIELD_ZOTERO_KEY, expr: "'x'" },
        { key: "year", expr: "2024" },
      ]),
    });
    expect(fm).toEqual({
      [FIELD_ZOTERO_KEY]: "ABC12345",
      [FIELD_CITEKEY]: "smith2024",
      year: 2024,
    });
  });

  it("writes zt-attachments only when a non-empty scope is given", () => {
    expect(
      buildFrontmatter(makeContext(), {
        compiled: compileFrontmatter([]),
        attachmentScope: ["ATCH1", "ATCH2"],
      })[FIELD_ATTACHMENTS],
    ).toEqual(["ATCH1", "ATCH2"]);
    expect(
      FIELD_ATTACHMENTS in
        buildFrontmatter(makeContext(), {
          compiled: compileFrontmatter([]),
          attachmentScope: [],
        }),
    ).toBe(false);
  });
});

describe("mergeManagedFrontmatter", () => {
  it("refreshes managed scalars and preserves unrelated keys", () => {
    const fm = { aliases: ["old"], title: "Old" };

    mergeManagedFrontmatter(fm, {
      title: "New",
      [FIELD_CITEKEY]: "smith2024",
    });

    expect(fm).toEqual({
      aliases: ["old"],
      title: "New",
      [FIELD_CITEKEY]: "smith2024",
    });
  });

  it("merges array-valued managed fields without duplicates", () => {
    const fm: Record<string, unknown> = { tags: ["zotero", "read"] };

    mergeManagedFrontmatter(fm, { tags: ["read", "paper"] });

    expect(fm.tags).toEqual(["zotero", "read", "paper"]);
  });
});
