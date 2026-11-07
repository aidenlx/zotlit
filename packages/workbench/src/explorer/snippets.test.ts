import { describe, expect, it } from "vitest";

import { formatPath } from "./display-tree";
import type {
  DisplayNode,
  DisplayValueType,
  PathSegment,
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
    expect(snippetKindsFor(helper(["noteLink"]))).toEqual([
      "output",
      "if-present",
    ]);
    expect(snippetKindsFor(placeholder(["noteLink"]))).toEqual([
      "output",
      "if-present",
    ]);
  });

  it("offers joined, then loop, for arrays whose elements stringify meaningfully", () => {
    expect(snippetKindsFor(value(["tags"], "array", ["a", "b"]))).toEqual([
      "joined",
      "loop",
    ]);
    expect(snippetKindsFor(value(["tags"], "array", [tag]))).toEqual([
      "joined",
      "loop",
    ]);
  });

  it("drops joined for arrays of plain objects (would only yield [object Object])", () => {
    expect(snippetKindsFor(value(["lines"], "array", [{ text: "x" }]))).toEqual(
      ["loop"],
    );
  });

  it("keeps joined for an empty array (element shape unknown)", () => {
    expect(snippetKindsFor(value(["tags"], "array", []))).toEqual([
      "joined",
      "loop",
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
    const node = helper(["noteLink"]);
    expect(renderSnippet(node, "liquid", "output")).toBe("{{ zt.noteLink }}");
    expect(renderSnippet(node, "eta", "output")).toBe("<%= zt.noteLink() %>");
  });

  // `backlink` is a bare URL; the snippet teaches the durable link as a
  // Markdown link a note can follow.
  it("wraps a backlink in a Markdown link", () => {
    const node = value(
      ["backlink"],
      "string",
      "zotero://open/library/items/ATTX2345?annotation=ANNX2345&page=4",
    );
    expect(renderSnippet(node, "liquid", "output")).toBe(
      "[Zotero]({{ zt.backlink }})",
    );
    expect(renderSnippet(node, "eta", "output")).toBe(
      "[Zotero](<%= zt.backlink %>)",
    );
    expect(renderSnippet(node, "liquid", "if-present")).toBe(
      "{% if zt.backlink %}[Zotero]({{ zt.backlink }}){% endif %}",
    );
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
    expect(renderSnippet(helper(["noteLink"]), "eta", "if-present")).toBe(
      "<% if (zt.noteLink()) { %><%= zt.noteLink() %><% } %>",
    );
  });
});

describe("renderSnippet — loop", () => {
  it("puts each item on its own Markdown list line in each engine", () => {
    expect(renderSnippet(value(["tags"], "array", []), "liquid", "loop")).toBe(
      "{% for tag in zt.tags %}\n- {{ tag }}{% endfor %}",
    );
    expect(renderSnippet(value(["creators"], "array", []), "eta", "loop")).toBe(
      "<% for (const creator of zt.creators) { %>\n- <%= creator %><% } %>",
    );
  });

  it("singularizes a nested array key", () => {
    expect(
      renderSnippet(value(["extra", "lines"], "array", []), "liquid", "loop"),
    ).toBe("{% for line in zt.extra.lines %}\n- {{ line }}{% endfor %}");
  });

  it("falls back to 'item' for a non-plural key", () => {
    expect(
      renderSnippet(value(["extra", "data"], "array", []), "liquid", "loop"),
    ).toBe("{% for item in zt.extra.data %}\n- {{ item }}{% endfor %}");
  });

  // Items with no text of their own would print `[object Object]`; the line
  // shows their first property instead.
  it("shows the first property of items that do not read as text", () => {
    const node = value(["lines"], "array", [{ text: "x", page: 1 }]);
    expect(renderSnippet(node, "liquid", "loop")).toBe(
      "{% for line in zt.lines %}\n- {{ line.page }}{% endfor %}",
    );
    expect(renderSnippet(node, "eta", "loop")).toBe(
      "<% for (const line of zt.lines) { %>\n- <%= line.page %><% } %>",
    );
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

function listProperty(list: PathSegment[], property: string): DisplayNode {
  return {
    kind: "list-property",
    path: [...list, property],
    key: `${formatPath(list)}[].${property}`,
    label: property,
    list,
    property,
    values: ["Rivera", "Chen"],
    preview: "Rivera, Chen",
  };
}

describe("list snippets never use an item index", () => {
  const authors = value(["authors"], "array", [tag, tag]);
  const family = listProperty(["authors"], "family");

  it("offers joined, then loop, for a list property", () => {
    expect(snippetKindsFor(family)).toEqual(["joined", "loop"]);
  });

  it("joins a list property's values in each engine", () => {
    expect(renderSnippet(family, "liquid", "joined")).toBe(
      '{{ zt.authors | map: "family" | join: ", " }}',
    );
    expect(renderSnippet(family, "eta", "joined")).toBe(
      '<%= zt.authors.map((author) => author.family).join(", ") %>',
    );
  });

  it("puts a list property's value for each item on its own line in each engine", () => {
    expect(renderSnippet(family, "liquid", "loop")).toBe(
      "{% for author in zt.authors %}\n- {{ author.family }}{% endfor %}",
    );
    expect(renderSnippet(family, "eta", "loop")).toBe(
      "<% for (const author of zt.authors) { %>\n- <%= author.family %><% } %>",
    );
  });

  it("quotes a property name that is not an identifier", () => {
    const node = listProperty(["attachments"], "file-name");
    expect(renderSnippet(node, "liquid", "joined")).toBe(
      '{{ zt.attachments | map: "file-name" | join: ", " }}',
    );
    expect(renderSnippet(node, "eta", "loop")).toBe(
      '<% for (const attachment of zt.attachments) { %>\n- <%= attachment["file-name"] %><% } %>',
    );
  });

  it("has no index in any form a list or a list property offers", () => {
    for (const node of [authors, family])
      for (const engine of ["liquid", "eta"] as const)
        for (const kind of snippetKindsFor(node))
          expect(renderSnippet(node, engine, kind)).not.toMatch(/\[\d+\]/);
  });
});
