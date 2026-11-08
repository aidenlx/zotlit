import type {
  DisplayNode,
  SnippetKind,
  TemplateEngine,
} from "#/explorer/index";
import { describe, expect, it } from "vitest";

import { TemplateEngine as EtaEngine } from "@zotlit/templates";
import { createLiquidEngine } from "@zotlit/templates/liquid";

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
      '<%= zt.authors.map((author) => author.family).filter((value) => value != null && value !== false && String(value).trim() !== "").join(", ") %>',
    );
    expect(text(family, "template", { kind: "loop" })).toBe(
      "{% for author in zt.authors %}{% if author.family != blank %}\n- {{ author.family }}{% endif %}{% endfor %}",
    );
  });

  // #1969: a creator with no family name, as Zotero keeps a one-field name:
  // the template context gives it an empty family name. A missing value and
  // a value that is false read as no value too.
  describe.each(["liquid", "eta"] as const)(
    "a list property with an item that has no value, in %s",
    (engine) => {
      const zt = {
        creators: [
          withText({ family: "Personal", literal: null }, "Ada Personal"),
          withText({ family: "", literal: "Research Group" }, "Research Group"),
          withText({ family: "Editor", literal: null }, "Erin Editor"),
          withText(
            { family: null, literal: "ZotLit Research Collective" },
            "ZotLit Research Collective",
          ),
          withText({ family: false, literal: "Lab" }, "Lab"),
        ],
      };
      const family = () => {
        const [creators] = buildDisplayTree(zt, {
          expanded: new Set(["creators"]),
          lists: "shape",
        });
        if (creators?.kind !== "value") throw new Error("shape");
        return creators.children!.find((child) => child.label === "family")!;
      };
      const render = async (snippet: string) =>
        engine === "liquid"
          ? createLiquidEngine().parseAndRender(snippet, { zt })
          : new EtaEngine().renderString(snippet, zt);

      it.each([
        { kind: "joined", note: "Personal, Editor" },
        { kind: "loop", note: "\n- Personal\n- Editor" },
      ] as const)(
        "renders the $kind form without the item, as its result says",
        async ({ kind, note }) => {
          const form = fieldForm(family(), { engine, mode: "template" }, kind);
          const rendered = await render(form.snippet);
          expect(rendered).toBe(note);
          // The result is the note's text, less the line break before the first line.
          expect(form.result).toBe(rendered.replace(/^\n/, ""));
        },
      );
    },
  );

  it("writes a list property as a list in a frontmatter expression", () => {
    const { family } = shapeNodes();
    expect(text(family, "expression")).toBe('zt.authors | map: "family"');
    expect(JSON.parse(text(family, "json-e"))).toEqual({
      $map: { $eval: "zt.authors" },
      "each(author)": { $eval: "author.family" },
    });
  });
});
