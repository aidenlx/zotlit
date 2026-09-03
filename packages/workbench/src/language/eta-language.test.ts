import { describe, expect, it } from "vitest";

import { etaLanguage, etaRange } from "./eta-language";
import { nodeNames as nodeNamesFor } from "./test-utils";

function nodeNames(source: string, from = 0, to = source.length): string[] {
  return nodeNamesFor(etaLanguage.parser, source, { from, to });
}

describe("eta grammar", () => {
  it("parses the three open delimiters and their trim markers", () => {
    const source = "<% a %><%= b %><%~ c %><%- d -%><%_ e _%>";
    const opens = nodeNames(source).filter((n) => n.startsWith("TagOpen"));
    expect(opens).toEqual([
      "TagOpen",
      "TagOpenInterp",
      "TagOpenRaw",
      "TagOpen",
      "TagOpen",
    ]);
    const tree = etaLanguage.parser.parse(source);
    const closes: string[] = [];
    tree.iterate({
      enter(node) {
        if (node.name === "TagClose")
          closes.push(source.slice(node.from, node.to));
      },
    });
    expect(closes).toEqual(["%>", "%>", "%>", "-%>", "_%>"]);
  });

  it("mounts JavaScript inside a tag body", () => {
    const source = "# <%= zt.title %>";
    expect(nodeNames(source)).toEqual([
      "Template",
      "Text",
      "Tag",
      "TagOpenInterp",
      "Script",
      "ExpressionStatement",
      "MemberExpression",
      "VariableName",
      ".",
      "PropertyName",
      "TagClose",
    ]);
  });

  it("parses the annotation shortcut as a call expression", () => {
    const source = "<%~ renderAnnotation(a) %>";
    expect(nodeNames(source)).toEqual([
      "Template",
      "Tag",
      "TagOpenRaw",
      "Script",
      "ExpressionStatement",
      "CallExpression",
      "VariableName",
      "ArgList",
      "(",
      "VariableName",
      ")",
      "TagClose",
    ]);
  });

  it("keeps a lone < in host text", () => {
    expect(nodeNames("a < b <%= c %>")).toEqual([
      "Template",
      "Text",
      "Tag",
      "TagOpenInterp",
      "Script",
      "ExpressionStatement",
      "VariableName",
      "TagClose",
    ]);
  });

  it("recovers a split JavaScript block across tags", () => {
    // The engine runs this as one program; the editor sees two partial scripts.
    const source = "<% if (x) { %>y<% } %>";
    const names = nodeNames(source);
    expect(names.filter((n) => n === "Tag")).toHaveLength(2);
    expect(names).toContain("IfStatement");
    expect(names).toContain("⚠");
  });
});

describe("etaRange", () => {
  const source = "a <%= zt.title %> b <%~ include('x', zt) %> <% c";
  //              0123456789012345678901234567890123456789012345678

  it("returns the tag body kind for a position inside a tag", () => {
    expect(etaRange(source, 8)).toEqual({
      from: 2,
      to: 17,
      kind: "output",
      closed: true,
      inLiteral: false,
    });
    expect(etaRange(source, 46)).toEqual({
      from: 44,
      to: 48,
      kind: "tag",
      closed: false,
      inLiteral: false,
    });
  });

  it("flags a position inside a string literal", () => {
    expect(etaRange(source, 33)).toMatchObject({
      kind: "output",
      inLiteral: true,
    });
  });

  it("returns null on host text and on the open delimiter", () => {
    expect(etaRange(source, 1)).toBeNull();
    expect(etaRange(source, 4)).toBeNull();
    expect(etaRange(source, 18)).toBeNull();
  });
});
