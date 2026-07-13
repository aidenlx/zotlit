import { describe, expect, it } from "vitest";

import {
  type DisplayNode,
  type DisplayValueType,
  formatPath,
  type PathSegment,
} from "./display-tree";
import { renderSnippet, snippetKindsFor } from "./snippets";

function value(
  path: PathSegment[],
  valueType: DisplayValueType,
  raw: unknown,
): DisplayNode {
  return {
    kind: "value",
    path,
    key: formatPath(path),
    label: String(path.at(-1)),
    valueType,
    value: raw,
    expandable: valueType === "array" || valueType === "object",
  };
}

function helper(path: PathSegment[]): DisplayNode {
  return {
    kind: "helper",
    path,
    key: formatPath(path),
    label: String(path.at(-1)),
    signatureHint: "ƒ(alias?, subpath?)",
    evaluated: "[[note]]",
  };
}

function placeholder(path: PathSegment[]): DisplayNode {
  return {
    kind: "placeholder",
    path,
    key: formatPath(path),
    label: String(path.at(-1)),
    reason: "Not imported",
  };
}

const tag = { name: "physics", toString: () => "physics" };

describe("snippetKindsFor", () => {
  it("offers output + if-present for a scalar leaf", () => {
    expect(snippetKindsFor(value(["title"], "string", "A"))).toEqual([
      "output",
      "if-present",
    ]);
  });

  it("offers output + if-present for object, opaque, and getter nodes", () => {
    expect(snippetKindsFor(value(["date"], "opaque", {}))).toEqual([
      "output",
      "if-present",
    ]);
    expect(snippetKindsFor(value(["extra"], "object", {}))).toEqual([
      "output",
      "if-present",
    ]);
    expect(snippetKindsFor(value(["parentItem"], "getter", undefined))).toEqual(
      ["output", "if-present"],
    );
  });

  it("offers output + if-present for helpers and placeholders", () => {
    expect(snippetKindsFor(helper(["fileLink"]))).toEqual([
      "output",
      "if-present",
    ]);
    expect(snippetKindsFor(placeholder(["noteLink"]))).toEqual([
      "output",
      "if-present",
    ]);
  });

  it("offers loop + joined for arrays whose elements stringify meaningfully", () => {
    expect(snippetKindsFor(value(["tags"], "array", ["a", "b"]))).toEqual([
      "loop",
      "joined",
    ]);
    expect(snippetKindsFor(value(["tags"], "array", [tag]))).toEqual([
      "loop",
      "joined",
    ]);
  });

  it("drops joined for arrays of plain objects (would only yield [object Object])", () => {
    expect(snippetKindsFor(value(["lines"], "array", [{ text: "x" }]))).toEqual(
      ["loop"],
    );
  });

  it("keeps joined for an empty array (element shape unknown)", () => {
    expect(snippetKindsFor(value(["tags"], "array", []))).toEqual([
      "loop",
      "joined",
    ]);
  });
});

describe("renderSnippet — output", () => {
  it("interpolates a scalar in each engine's delimiters", () => {
    const node = value(["title"], "string", "A");
    expect(renderSnippet(node, "liquid", "output")).toBe("{{ zt.title }}");
    expect(renderSnippet(node, "eta", "output")).toBe("<%= zt.title %>");
  });

  it("uses Liquid auto-invoke but explicit Eta call for helpers", () => {
    const node = helper(["fileLink"]);
    expect(renderSnippet(node, "liquid", "output")).toBe("{{ zt.fileLink }}");
    expect(renderSnippet(node, "eta", "output")).toBe("<%= zt.fileLink() %>");
  });

  it("treats placeholders like helpers for the call form", () => {
    const node = placeholder(["noteLink"]);
    expect(renderSnippet(node, "eta", "output")).toBe("<%= zt.noteLink() %>");
  });

  it("brackets non-identifier and index segments in the accessor", () => {
    const node = value(["annotations", 0, "comment"], "string", "c");
    expect(renderSnippet(node, "liquid", "output")).toBe(
      "{{ zt.annotations[0].comment }}",
    );
  });
});

describe("renderSnippet — if-present", () => {
  it("guards output on truthiness in each engine", () => {
    const node = value(["abstract"], "string", "A");
    expect(renderSnippet(node, "liquid", "if-present")).toBe(
      "{% if zt.abstract %}{{ zt.abstract }}{% endif %}",
    );
    expect(renderSnippet(node, "eta", "if-present")).toBe(
      "<% if (zt.abstract) { %><%= zt.abstract %><% } %>",
    );
  });

  it("guards on the call form for an Eta helper", () => {
    expect(renderSnippet(helper(["fileLink"]), "eta", "if-present")).toBe(
      "<% if (zt.fileLink()) { %><%= zt.fileLink() %><% } %>",
    );
  });
});

describe("renderSnippet — loop", () => {
  it("singularizes the array key as the element variable", () => {
    expect(renderSnippet(value(["tags"], "array", []), "liquid", "loop")).toBe(
      "{% for tag in zt.tags %}{{ tag }}{% endfor %}",
    );
    expect(renderSnippet(value(["creators"], "array", []), "eta", "loop")).toBe(
      "<% for (const creator of zt.creators) { %><%= creator %><% } %>",
    );
  });

  it("singularizes a nested array key", () => {
    expect(
      renderSnippet(value(["extra", "lines"], "array", []), "liquid", "loop"),
    ).toBe("{% for line in zt.extra.lines %}{{ line }}{% endfor %}");
  });

  it("falls back to 'item' for an index or non-plural key", () => {
    expect(
      renderSnippet(value(["matrix", 0], "array", []), "liquid", "loop"),
    ).toBe("{% for item in zt.matrix[0] %}{{ item }}{% endfor %}");
  });
});

describe("renderSnippet — joined", () => {
  it("joins with a comma in each engine", () => {
    const node = value(["tags"], "array", ["a"]);
    expect(renderSnippet(node, "liquid", "joined")).toBe(
      '{{ zt.tags | join: ", " }}',
    );
    expect(renderSnippet(node, "eta", "joined")).toBe(
      '<%= zt.tags.join(", ") %>',
    );
  });
});
