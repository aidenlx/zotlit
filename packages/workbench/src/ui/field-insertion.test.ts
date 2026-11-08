import type {
  DisplayNode,
  SnippetKind,
  TemplateEngine,
} from "#/explorer/index";
import { describe, expect, it } from "vitest";

import { fieldForm } from "./field-insertion";
import type { FieldInsertionContext } from "./field-insertion";

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

/** The text an insert of `node` writes at a place of `mode`, in the form `kind`. */
const text = (
  node: DisplayNode,
  mode: FieldInsertionContext["mode"],
  {
    engine = "liquid",
    kind,
  }: { engine?: TemplateEngine; kind?: SnippetKind } = {},
) => fieldForm(node, { engine, mode }, kind).snippet;

describe("fieldForm", () => {
  it("inserts a list joined in one line, never by an index", () => {
    const { authors } = shapeNodes();
    expect(text(authors, "template")).toBe('{{ zt.authors | join: ", " }}');
  });

  it("inserts a list property joined in one line", () => {
    const { family } = shapeNodes();
    expect(text(family, "template", { engine: "eta" })).toBe(
      '<%= zt.authors.map((author) => author.family).join(", ") %>',
    );
    expect(text(family, "template", { kind: "loop" })).toBe(
      "{% for author in zt.authors %}\n- {{ author.family }}{% endfor %}",
    );
  });

  it("writes a list property as a list in a frontmatter expression", () => {
    const { family } = shapeNodes();
    expect(text(family, "expression")).toBe('zt.authors | map: "family"');
    expect(JSON.parse(text(family, "json-e"))).toEqual({
      $map: { $eval: "zt.authors" },
      "each(author)": { $eval: "author.family" },
    });
  });
});
