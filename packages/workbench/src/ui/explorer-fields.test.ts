import type { DisplayNode } from "#/explorer/index";
import { describe, expect, it } from "vitest";

import { fieldSnippet, fieldValueText } from "./explorer-fields";

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
