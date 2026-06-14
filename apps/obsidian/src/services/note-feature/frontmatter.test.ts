import { describe, expect, it } from "vitest";

import { buildFrontmatter, evalFrontmatterField } from "./frontmatter";
import { type NoteTemplateContext } from "./types";

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

describe("evalFrontmatterField", () => {
  it("evaluates an expression against the zt root", () => {
    expect(evalFrontmatterField("zt.title", makeContext())).toBe("A Study");
  });
});

describe("buildFrontmatter", () => {
  it("writes system fields and evaluated user expressions", () => {
    const fm = buildFrontmatter(makeContext(), {
      fields: [{ key: "title", expr: "zt.title" }],
    });
    expect(fm).toEqual({
      "zotero-key": "ABC12345",
      citekey: "smith2024",
      title: "A Study",
    });
  });

  it("omits citekey when the item has none", () => {
    const fm = buildFrontmatter(makeContext({ citationKey: null }), {
      fields: [],
    });
    expect(fm).toEqual({ "zotero-key": "ABC12345" });
  });

  it("skips reserved and empty keys", () => {
    const fm = buildFrontmatter(makeContext(), {
      fields: [
        { key: "zotero-key", expr: "'x'" },
        { key: "", expr: "'y'" },
        { key: "year", expr: "2024" },
      ],
    });
    expect(fm).toEqual({
      "zotero-key": "ABC12345",
      citekey: "smith2024",
      year: 2024,
    });
  });

  it("writes zt-attachments only when a non-empty scope is given", () => {
    expect(
      buildFrontmatter(makeContext(), {
        fields: [],
        attachmentScope: ["ATCH1", "ATCH2"],
      })["zt-attachments"],
    ).toEqual(["ATCH1", "ATCH2"]);
    expect(
      "zt-attachments" in
        buildFrontmatter(makeContext(), { fields: [], attachmentScope: [] }),
    ).toBe(false);
  });

  it("skips a failing expression and reports it", () => {
    const errors: string[] = [];
    const fm = buildFrontmatter(makeContext(), {
      fields: [{ key: "boom", expr: "zt.nope.deep" }],
      onError: (key) => errors.push(key),
    });
    expect("boom" in fm).toBe(false);
    expect(errors).toEqual(["boom"]);
  });
});
