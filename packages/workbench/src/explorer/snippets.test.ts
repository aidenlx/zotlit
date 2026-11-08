import { describe, expect, it } from "vitest";

import { formatPath } from "./display-tree";
import type {
  DisplayNode,
  DisplayValueType,
  PathSegment,
} from "./display-tree";
import { buildDisplayTree } from "./display-tree";
import { renderSnippet, snippetKindsFor, snippetResult } from "./snippets";
import type { SnippetKind } from "./snippets";
import { withText } from "./test-records";

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
      "{% for line in zt.lines %}{% if line.page != nil %}\n- {{ line.page }}{% endif %}{% endfor %}",
    );
    expect(renderSnippet(node, "eta", "loop")).toBe(
      "<% for (const line of zt.lines) { %><% if (line.page != null) { %>\n- <%= line.page %><% } %><% } %>",
    );
  });
});

describe("a list's preview and its loop line", () => {
  // Items with different keys: the first item has no `a`.
  it("show the same property for each item", () => {
    const [node] = buildDisplayTree(
      { lines: [{ b: "first" }, { a: "second", b: "third" }] },
      { expanded: new Set() },
    );
    expect(node).toMatchObject({ preview: "second" });
    expect(renderSnippet(node!, "liquid", "loop")).toBe(
      "{% for line in zt.lines %}{% if line.a != nil %}\n- {{ line.a }}{% endif %}{% endfor %}",
    );
  });

  // A cited item's alphabetically first property is an abstract the paper
  // does not have.
  it("pass over a property no item has a value for", () => {
    const [node] = buildDisplayTree(
      {
        items: [
          { abstract: "", title: "Why Most Findings Are False" },
          { abstract: null, title: "Ten Simple Rules" },
        ],
      },
      { expanded: new Set() },
    );
    expect(node).toMatchObject({
      preview: "Why Most Findings Are False, Ten Simple Rules",
    });
    expect(renderSnippet(node!, "liquid", "loop")).toBe(
      "{% for item in zt.items %}{% if item.title != nil %}\n- {{ item.title }}{% endif %}{% endfor %}",
    );
  });

  // A citation's alphabetically first property is the cited item, a record
  // that would print `[object Object]`.
  it("pass over a property whose values do not read as text", () => {
    const [node] = buildDisplayTree(
      {
        citations: [
          { item: { title: "Alpha" }, title: "Alpha" },
          { item: { title: "Beta" }, title: "Beta" },
        ],
      },
      { expanded: new Set() },
    );
    expect(node).toMatchObject({ preview: "Alpha, Beta" });
    expect(renderSnippet(node!, "liquid", "loop")).toBe(
      "{% for citation in zt.citations %}{% if citation.title != nil %}\n- {{ citation.title }}{% endif %}{% endfor %}",
    );
  });

  it("prefer a property that reads as text for every item", () => {
    const [node] = buildDisplayTree(
      {
        lines: [
          { a: { nested: true }, b: "first" },
          { a: "second", b: "third" },
        ],
      },
      { expanded: new Set() },
    );
    expect(renderSnippet(node!, "liquid", "loop")).toBe(
      "{% for line in zt.lines %}{% if line.b != nil %}\n- {{ line.b }}{% endif %}{% endfor %}",
    );
  });

  it("show the item itself when every item reads as text", () => {
    const [node] = buildDisplayTree(
      { tags: ["physics", "methods"] },
      { expanded: new Set() },
    );
    expect(node).toMatchObject({ preview: "physics, methods" });
    expect(snippetKindsFor(node!)).toEqual(["joined", "loop"]);
    expect(renderSnippet(node!, "liquid", "loop")).toBe(
      "{% for tag in zt.tags %}\n- {{ tag }}{% endfor %}",
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
      '{{ zt.authors | map: "family" | compact | join: ", " }}',
    );
    expect(renderSnippet(family, "eta", "joined")).toBe(
      '<%= zt.authors.map((author) => author.family).filter((value) => value != null).join(", ") %>',
    );
  });

  it("puts a list property's value for each item on its own line in each engine", () => {
    expect(renderSnippet(family, "liquid", "loop")).toBe(
      "{% for author in zt.authors %}{% if author.family != nil %}\n- {{ author.family }}{% endif %}{% endfor %}",
    );
    expect(renderSnippet(family, "eta", "loop")).toBe(
      "<% for (const author of zt.authors) { %><% if (author.family != null) { %>\n- <%= author.family %><% } %><% } %>",
    );
  });

  it("quotes a property name that is not an identifier", () => {
    const node = listProperty(["attachments"], "file-name");
    expect(renderSnippet(node, "liquid", "joined")).toBe(
      '{{ zt.attachments | map: "file-name" | compact | join: ", " }}',
    );
    expect(renderSnippet(node, "eta", "loop")).toBe(
      '<% for (const attachment of zt.attachments) { %><% if (attachment["file-name"] != null) { %>\n- <%= attachment["file-name"] %><% } %><% } %>',
    );
  });

  it("has no index in any form a list or a list property offers", () => {
    for (const node of [authors, family])
      for (const engine of ["liquid", "eta"] as const)
        for (const kind of snippetKindsFor(node))
          expect(renderSnippet(node, engine, kind)).not.toMatch(/\[\d+\]/);
  });
});

describe("snippetResult", () => {
  /** What the first form a node offers, the one an insert uses, writes. */
  const fieldResult = (subject: DisplayNode, kind?: SnippetKind) =>
    snippetResult(subject, kind ?? snippetKindsFor(subject)[0]!);
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
    const { authors, family } = resultShape();
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

function resultShape(): { authors: DisplayNode; family: DisplayNode } {
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

// Final review of spec #1962 (A2): the row preview, the details values and
// the snippet result read a list by one rule.
describe("a list reads the same in its row and in its result", () => {
  const shape = (data: Record<string, unknown>) => {
    const [list] = buildDisplayTree(data, {
      expanded: new Set(Object.keys(data)),
      lists: "shape",
    });
    if (list?.kind !== "value") throw new Error("list");
    return list;
  };

  it("leaves out an item whose line has no text of its own", () => {
    const list = shape({
      files: [{ meta: { size: 1 } }, { meta: withText({}, "Draft") }],
    });
    expect(list.preview).toBe("Draft");
    expect(snippetResult(list, "loop")).toBe("- Draft");
  });

  it("reads a helper on the line by what it returns", () => {
    const list = shape({
      files: [{ name: () => "a.pdf" }, { name: () => "b.pdf" }],
    });
    expect(list.preview).toBe("a.pdf, b.pdf");
    expect(snippetResult(list, "loop")).toBe("- a.pdf\n- b.pdf");
  });

  it("links a backlink in each line of a list property's loop", () => {
    const list = shape({
      annotations: [
        { backlink: "zotero://open/1", text: "One" },
        { backlink: "zotero://open/2", text: "Two" },
      ],
    });
    const backlink = list.children!.find((node) => node.label === "backlink")!;
    expect(snippetKindsFor(backlink)).toEqual(["loop"]);
    expect(renderSnippet(backlink, "liquid", "loop")).toBe(
      "{% for annotation in zt.annotations %}{% if annotation.backlink != nil %}\n- [Zotero]({{ annotation.backlink }}){% endif %}{% endfor %}",
    );
    expect(renderSnippet(backlink, "eta", "loop")).toBe(
      "<% for (const annotation of zt.annotations) { %><% if (annotation.backlink != null) { %>\n- [Zotero](<%= annotation.backlink %>)<% } %><% } %>",
    );
    expect(snippetResult(backlink, "loop")).toBe(
      "- [Zotero](zotero://open/1)\n- [Zotero](zotero://open/2)",
    );
  });
});
