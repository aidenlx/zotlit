import type { DisplayNode } from "#/explorer/index";
import { describe, expect, it } from "vitest";

import { fieldResult, fieldSnippet, fieldValueText } from "./explorer-fields";

import { buildDisplayTree } from "#/explorer/index";
import { withText } from "#/explorer/test-records";

function shapeNodes(): { authors: DisplayNode; family: DisplayNode } {
  const [authors] = buildDisplayTree(
    {
      authors: [
        withText({ family: "Rivera", given: "Mara" }, "Mara Rivera"),
        withText({ family: "Chen", given: "Li" }, "Li Chen"),
      ],
    },
    { expanded: new Set(["authors"]), lists: "shape" },
  );
  if (authors?.kind !== "value" || !authors.children) throw new Error("shape");
  return { authors, family: authors.children[0]! };
}

describe("fieldSnippet", () => {
  it("inserts a list joined in one line, never by an index", () => {
    const { authors } = shapeNodes();
    expect(fieldSnippet(authors, "template")).toBe(
      '{{ zt.authors | join: ", " }}',
    );
  });

  it("inserts a list property joined in one line", () => {
    const { family } = shapeNodes();
    expect(fieldSnippet(family, "template", { engine: "eta" })).toBe(
      '<%= zt.authors.map((author) => author.family).join(", ") %>',
    );
    expect(fieldSnippet(family, "template", { kind: "loop" })).toBe(
      "{% for author in zt.authors %}\n- {{ author.family }}{% endfor %}",
    );
  });

  it("writes a list property as a list in a frontmatter expression", () => {
    const { family } = shapeNodes();
    expect(fieldSnippet(family, "expression")).toBe(
      'zt.authors | map: "family"',
    );
    expect(JSON.parse(fieldSnippet(family, "json-e"))).toEqual({
      $map: { $eval: "zt.authors" },
      "each(author)": { $eval: "author.family" },
    });
  });
});

describe("fieldValueText", () => {
  it("shows a list and a list property with every item in one line", () => {
    const { authors, family } = shapeNodes();
    expect(fieldValueText(authors)).toBe("Mara Rivera, Li Chen");
    expect(fieldValueText(family)).toBe("Rivera, Chen");
  });
});

describe("fieldResult", () => {
  const node = (data: Record<string, unknown>) =>
    buildDisplayTree(data, { expanded: new Set() })[0]!;

  it("gives what a field writes into the note for this item", () => {
    expect(fieldResult(node({ title: "Linked notes in practice" }))).toBe(
      "Linked notes in practice",
    );
    expect(fieldResult(node({ year: 2024 }))).toBe("2024");
    expect(fieldResult(node({ backlink: "zotero://select/items/1_ABC" }))).toBe(
      "[Zotero](zotero://select/items/1_ABC)",
    );
  });

  it("gives a list in one line, or one Markdown list line per item", () => {
    const { authors, family } = shapeNodes();
    expect(fieldResult(authors)).toBe("Mara Rivera, Li Chen");
    expect(fieldResult(authors, "loop")).toBe("- Mara Rivera\n- Li Chen");
    expect(fieldResult(family)).toBe("Rivera, Chen");
    expect(fieldResult(family, "loop")).toBe("- Rivera\n- Chen");
  });

  it("gives nothing for a field this item has no value for", () => {
    expect(fieldResult(node({ abstract: "" }))).toBeNull();
    expect(fieldResult(node({ abstract: null }))).toBeNull();
    expect(fieldResult(node({ tags: [] }))).toBeNull();
  });
});
