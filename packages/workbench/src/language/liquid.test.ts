import { describe, expect, it } from "vitest";

import { liquidMarkdown, liquidRanges } from "./liquid";
import { nodeNames as nodeNamesFor } from "./test-utils";

function nodeNames(source: string, from = 0, to = source.length): string[] {
  return nodeNamesFor(liquidMarkdown.language.parser, source, { from, to });
}

describe("liquidMarkdown grammar", () => {
  it("parses an output with a filter chain inside Markdown", () => {
    const source = "# {{ zt.title | upcase }}";
    expect(nodeNames(source)).toEqual([
      "Template",
      "Text",
      "Interpolation",
      "{{",
      "MemberExpression",
      "VariableName",
      ".",
      "PropertyName",
      "Filter",
      "|",
      "FilterName",
      "}}",
    ]);
  });

  it("parses a for block and the annotation shortcut tag", () => {
    const source =
      "{% for a in zt.annotations %}{% render_annotation a %}{% endfor %}";
    const names = nodeNames(source);
    expect(names.slice(0, 3)).toEqual(["Template", "ForDirective", "Tag"]);
    expect(names).toContain("EndTag");
    // The shortcut is a plain tag: its name is a TagName, its argument a VariableName.
    const shortcut = nodeNames(source, 29, 54);
    expect(shortcut).toEqual(["Tag", "{%", "TagName", "VariableName", "%}"]);
  });

  it("parses a multiline {% liquid %} block as nested tags", () => {
    const source = "{% liquid\n  assign x = zt.title | downcase\n  echo x\n%}";
    expect(nodeNames(source)).toEqual([
      "Template",
      "Tag",
      "{%",
      "liquid",
      "Tag",
      "assign",
      "AssignmentExpression",
      "VariableName",
      "AssignOp",
      "MemberExpression",
      "VariableName",
      ".",
      "PropertyName",
      "Filter",
      "|",
      "FilterName",
      "Tag",
      "echo",
      "VariableName",
      "%}",
    ]);
  });

  it("parses a filter argument as a string literal", () => {
    const source = '{{ zt.date | date: "%Y" }}';
    expect(nodeNames(source)).toContain("StringLiteral");
    expect(nodeNames(source).filter((n) => n === "⚠")).toEqual([]);
  });
});

describe("liquidRanges", () => {
  it("bounds outputs, tags, structural tags, and comments", () => {
    //              0         1         2         3         4         5
    //              012345678901234567890123456789012345678901234567890123
    const source = "{{ a }}{% if x %}{% managed %}{% # note %}{% endmanaged %}";
    expect(liquidRanges(source)).toEqual([
      { from: 0, to: 7, kind: "output", name: "", closed: true },
      { from: 7, to: 17, kind: "tag", name: "if", closed: true },
      { from: 17, to: 30, kind: "structural", name: "managed", closed: true },
      { from: 30, to: 42, kind: "comment", name: "#", closed: true },
      {
        from: 42,
        to: 58,
        kind: "structural",
        name: "endmanaged",
        closed: true,
      },
    ]);
  });

  it("keeps delimiters inside quotes from closing a tag", () => {
    const source = "{% assign s = '}}' %}{{ s }}";
    expect(liquidRanges(source).map((r) => [r.from, r.to, r.kind])).toEqual([
      [0, 21, "tag"],
      [21, 28, "output"],
    ]);
  });

  it("skips raw bodies and folds comment blocks into one range", () => {
    const source =
      "{% raw %}{{ x }}{% endraw %}{% comment %}{{ y }}{% endcomment %}";
    expect(liquidRanges(source)).toEqual([
      { from: 0, to: 9, kind: "tag", name: "raw", closed: true },
      { from: 16, to: 28, kind: "tag", name: "endraw", closed: true },
      { from: 28, to: 64, kind: "comment", name: "comment", closed: true },
    ]);
  });

  it("reports an unterminated tag as open to the end of the source", () => {
    expect(liquidRanges("text {{ zt.ti")).toEqual([
      { from: 5, to: 13, kind: "output", name: "", closed: false },
    ]);
  });

  it("recognizes trim markers on tag names", () => {
    expect(liquidRanges("{%- if x -%}")[0]).toMatchObject({
      name: "if",
      closed: true,
      to: 12,
    });
  });
});
