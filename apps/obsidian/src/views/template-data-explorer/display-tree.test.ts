import { describe, expect, it } from "vitest";

import { markInertPlaceholder } from "@/services/template/inert-placeholder";

import {
  annotationKeyAtPath,
  buildDisplayTree,
  buildFilteredDisplayTree,
  copyValue,
  findAnnotationRoot,
  formatPath,
  type DisplayNode,
} from "./display-tree";

function expectValueChildren(node: DisplayNode): readonly DisplayNode[] {
  expect(node.kind).toBe("value");
  if (node.kind !== "value") throw new Error("unexpected node kind");
  expect(node.children).toBeDefined();
  return node.children!;
}

describe("buildDisplayTree — primitives", () => {
  it("maps primitive fields to ValueNodes, sorted by key", () => {
    const root = { title: "Hello", pages: 12, ok: true, missing: null };
    const nodes = buildDisplayTree(root, { expanded: new Set() });

    expect(nodes).toEqual([
      {
        path: ["missing"],
        key: "missing",
        label: "missing",
        kind: "value",
        valueType: "null",
        value: null,
        expandable: false,
      },
      {
        path: ["ok"],
        key: "ok",
        label: "ok",
        kind: "value",
        valueType: "boolean",
        value: true,
        expandable: false,
      },
      {
        path: ["pages"],
        key: "pages",
        label: "pages",
        kind: "value",
        valueType: "number",
        value: 12,
        expandable: false,
      },
      {
        path: ["title"],
        key: "title",
        label: "title",
        kind: "value",
        valueType: "string",
        value: "Hello",
        expandable: false,
      },
    ]);
  });

  it("sorts object keys alphabetically while leaving array order intact", () => {
    const root = { zebra: 1, apple: 2, mango: 3 };
    const nodes = buildDisplayTree(root, { expanded: new Set() });
    expect(nodes.map((n) => n.label)).toEqual(["apple", "mango", "zebra"]);

    const arrRoot = { list: ["c", "a", "b"] };
    const arrNodes = buildDisplayTree(arrRoot, { expanded: new Set(["list"]) });
    const list = arrNodes[0];
    const items = list?.kind === "value" ? (list.children ?? []) : [];
    expect(items.map((n) => (n as { value: unknown }).value)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });
});

describe("buildDisplayTree — containers", () => {
  it("does not populate children when collapsed", () => {
    const root = { meta: { a: 1 } };
    const nodes = buildDisplayTree(root, { expanded: new Set() });

    expect(nodes).toMatchObject([
      {
        label: "meta",
        key: "meta",
        path: ["meta"],
        kind: "value",
        valueType: "object",
        expandable: true,
        size: 1,
      },
    ]);
    expect(nodes[0]).not.toHaveProperty("children");
  });

  it("populates children with stable path keys when expanded", () => {
    const root = { meta: { a: 1 } };
    const nodes = buildDisplayTree(root, { expanded: new Set(["meta"]) });

    expect(nodes[0]).toMatchObject({
      label: "meta",
      key: "meta",
      children: [
        {
          label: "a",
          key: "meta.a",
          path: ["meta", "a"],
          valueType: "number",
          value: 1,
        },
      ],
    });
  });

  it("walks arrays with index-based paths and keys", () => {
    const root = { tags: [{ name: "x" }] };
    const nodes = buildDisplayTree(root, {
      expanded: new Set(["tags", "tags[0]"]),
    });

    const tagsNode = nodes[0];
    expect(tagsNode).toMatchObject({
      label: "tags",
      key: "tags",
      valueType: "array",
      size: 1,
    });

    const arrItem =
      tagsNode?.kind === "value" ? tagsNode.children?.[0] : undefined;
    expect(arrItem).toMatchObject({
      key: "tags[0]",
      path: ["tags", 0],
      valueType: "object",
    });

    const nameNode =
      arrItem?.kind === "value" ? arrItem.children?.[0] : undefined;
    expect(nameNode).toMatchObject({
      key: "tags[0].name",
      path: ["tags", 0, "name"],
      label: "name",
      value: "x",
    });
  });
});

describe("buildDisplayTree — lazy getters", () => {
  function makeGetterFixture() {
    let calls = 0;
    const obj: Record<string, unknown> = {};
    Object.defineProperty(obj, "parent", {
      enumerable: true,
      get: () => {
        calls++;
        return { x: 1 };
      },
    });
    return { obj, getCalls: () => calls };
  }

  it("does not invoke the getter while collapsed", () => {
    const { obj, getCalls } = makeGetterFixture();
    const nodes = buildDisplayTree(obj, { expanded: new Set() });

    expect(nodes).toMatchObject([
      {
        label: "parent",
        key: "parent",
        valueType: "getter",
        value: undefined,
        expandable: true,
      },
    ]);
    expect(nodes[0]).not.toHaveProperty("children");
    expect(getCalls()).toBe(0);
  });

  it("invokes the getter exactly once when expanded and materializes children", () => {
    const { obj, getCalls } = makeGetterFixture();
    const nodes = buildDisplayTree(obj, { expanded: new Set(["parent"]) });

    expect(nodes[0]).toMatchObject({
      label: "parent",
      key: "parent",
      valueType: "object",
      children: [{ label: "x", key: "parent.x", value: 1 }],
    });
    expect(getCalls()).toBe(1);
  });
});

describe("buildDisplayTree — functions as helper nodes", () => {
  it("maps functions to HelperNodes with arity-based signature hints", () => {
    const link = (_a: unknown, _b: unknown) => "";
    const none = () => "";
    const root = { link, none };
    const nodes = buildDisplayTree(root, { expanded: new Set() });

    expect(nodes).toMatchObject([
      { kind: "helper", label: "link", signatureHint: "ƒ(·, ·)" },
      { kind: "helper", label: "none", signatureHint: "ƒ()" },
    ]);
  });

  it("evaluates a helper's zero-argument rendering", () => {
    const greet = () => "hello";
    const root = { greet };
    const nodes = buildDisplayTree(root, { expanded: new Set() });

    expect(nodes).toMatchObject([{ kind: "helper", evaluated: "hello" }]);
  });

  it("evaluates to null when the helper returns null or undefined", () => {
    const returnsNull = () => null;
    const returnsUndefined = () => undefined;
    const root = { returnsNull, returnsUndefined };
    const nodes = buildDisplayTree(root, { expanded: new Set() });

    expect(nodes).toMatchObject([
      { kind: "helper", evaluated: null },
      { kind: "helper", evaluated: null },
    ]);
  });

  it("evaluates to null when the helper throws", () => {
    const boom = () => {
      throw new Error("boom");
    };
    const root = { boom };
    const nodes = buildDisplayTree(root, { expanded: new Set() });

    expect(nodes).toMatchObject([{ kind: "helper", evaluated: null }]);
  });

  it("uses the link-helper signature hint for noteLink/fileLink/imgLink labels", () => {
    const root = {
      noteLink: (_a?: string, _b?: string) => "",
      fileLink: (_a?: string, _b?: string) => "",
      imgLink: (_a?: string, _b?: string) => "",
      other: (_a?: string, _b?: string) => "",
    };
    const nodes = buildDisplayTree(root, { expanded: new Set() });

    expect(nodes).toMatchObject([
      { label: "fileLink", signatureHint: "ƒ(alias?, subpath?)" },
      { label: "imgLink", signatureHint: "ƒ(alias?, subpath?)" },
      { label: "noteLink", signatureHint: "ƒ(alias?, subpath?)" },
      { label: "other", signatureHint: "ƒ(·, ·)" },
    ]);
  });
});

describe("buildDisplayTree — inert placeholder nodes", () => {
  it("maps a branded function to a PlaceholderNode with its reason, not a HelperNode", () => {
    const placeholder = markInertPlaceholder(() => "", "Not imported");
    const root = { link: placeholder };
    const nodes = buildDisplayTree(root, { expanded: new Set() });

    expect(nodes).toEqual([
      {
        path: ["link"],
        key: "link",
        label: "link",
        kind: "placeholder",
        reason: "Not imported",
      },
    ]);
  });
});

describe("buildDisplayTree — expansion survives a rebuilt context", () => {
  it("produces deep-equal results across distinct-but-equal roots with the same expanded set", () => {
    const expanded = new Set(["meta"]);
    const a = buildDisplayTree({ meta: { a: 1 } }, { expanded });
    const b = buildDisplayTree({ meta: { a: 1 } }, { expanded });

    expect(a).toEqual(b);
  });

  it("preserves expanded children when values change in a refetched context", () => {
    const expanded = new Set(["annotations", "annotations[0]"]);
    const before = buildDisplayTree(
      { annotations: [{ comment: "old text", page: 1 }] },
      { expanded },
    );
    const after = buildDisplayTree(
      { annotations: [{ comment: "new text", page: 2 }] },
      { expanded },
    );

    const itemBefore = expectValueChildren(before[0]!)[0]!;
    const itemAfter = expectValueChildren(after[0]!)[0]!;
    const childrenBefore = expectValueChildren(itemBefore);
    const childrenAfter = expectValueChildren(itemAfter);

    expect(childrenBefore[0]).toMatchObject({
      key: "annotations[0].comment",
      value: "old text",
    });
    expect(childrenAfter[0]).toMatchObject({
      key: "annotations[0].comment",
      value: "new text",
    });
  });

  it("keeps structural keys stable when annotation count stays the same", () => {
    const expanded = new Set(["annotations", "annotations[1]"]);
    const before = buildDisplayTree(
      {
        annotations: [
          { key: "A1", comment: "x" },
          { key: "A2", comment: "y" },
        ],
      },
      { expanded },
    );
    const after = buildDisplayTree(
      {
        annotations: [
          { key: "A1", comment: "x edited" },
          { key: "A2", comment: "y edited" },
        ],
      },
      { expanded },
    );

    const secondBefore = expectValueChildren(before[0]!)[1];
    const secondAfter = expectValueChildren(after[0]!)[1];
    expect(secondBefore).toBeDefined();
    expect(secondAfter).toBeDefined();
    expect(secondBefore!.key).toBe("annotations[1]");
    expect(secondAfter!.key).toBe("annotations[1]");
    expect(
      secondBefore!.kind === "value" && secondBefore!.children,
    ).toBeTruthy();
    expect(secondAfter!.kind === "value" && secondAfter!.children).toBeTruthy();
  });
});

describe("findAnnotationRoot — refetch scenarios", () => {
  it("finds the annotation in a refetched context by key", () => {
    const before = {
      annotations: [
        { key: "A1", comment: "old" },
        { key: "A2", comment: "anchor" },
      ],
    };
    const after = {
      annotations: [
        { key: "A1", comment: "old" },
        { key: "A2", comment: "anchor edited" },
      ],
    };

    expect(findAnnotationRoot(before, "A2")).toBe(before.annotations[1]);
    expect(findAnnotationRoot(after, "A2")).toBe(after.annotations[1]);
    expect(findAnnotationRoot(after, "A2")!.comment).toBe("anchor edited");
  });

  it("returns null when the anchored annotation vanished from a refetched context", () => {
    const before = {
      annotations: [
        { key: "A1", comment: "x" },
        { key: "A2", comment: "anchor" },
      ],
    };
    const after = { annotations: [{ key: "A1", comment: "x" }] };

    expect(findAnnotationRoot(before, "A2")).not.toBeNull();
    expect(findAnnotationRoot(after, "A2")).toBeNull();
  });
});

describe("buildDisplayTree — opaque non-plain objects", () => {
  class Stamp {
    constructor(readonly iso: string) {}
    toString() {
      return this.iso;
    }
  }

  it("renders a non-plain object as an opaque leaf, even when expanded", () => {
    const root = { when: new Stamp("2020-01-01") };
    const nodes = buildDisplayTree(root, { expanded: new Set(["when"]) });

    expect(nodes).toHaveLength(1);
    const node = nodes[0];
    expect(node).toMatchObject({
      kind: "value",
      label: "when",
      key: "when",
      valueType: "opaque",
      expandable: false,
    });
    expect((node as { value: unknown }).value).toBeInstanceOf(Stamp);
    expect(node).not.toHaveProperty("children");
  });
});

describe("buildDisplayTree — container preview from custom toString", () => {
  it("previews a plain container that defines its own toString", () => {
    const creator: Record<string, unknown> = {
      firstName: "John",
      lastName: "Smith",
    };
    Object.defineProperty(creator, "toString", {
      value: () => "John Smith",
      enumerable: false,
    });
    const root = { creators: [creator] };
    const nodes = buildDisplayTree(root, { expanded: new Set(["creators"]) });

    const item =
      nodes[0]?.kind === "value" ? nodes[0].children?.[0] : undefined;
    expect(item).toMatchObject({
      valueType: "object",
      expandable: true,
      preview: "John Smith",
    });
  });

  it("omits a preview for a plain container with no custom toString", () => {
    const root = { meta: { a: 1, b: 2 } };
    const nodes = buildDisplayTree(root, { expanded: new Set() });
    expect(nodes[0]).not.toHaveProperty("preview");
  });

  it("omits a preview for an array (default Array toString)", () => {
    const root = { tags: [1, 2, 3] };
    const nodes = buildDisplayTree(root, { expanded: new Set() });
    expect(nodes[0]).not.toHaveProperty("preview");
  });
});

describe("formatPath", () => {
  it("formats mixed string/number segments without a root alias", () => {
    expect(formatPath(["annotations", 0, "comment"])).toBe(
      "annotations[0].comment",
    );
  });

  it("formats with a root alias", () => {
    expect(formatPath(["annotations", 0, "comment"], "zt")).toBe(
      "zt.annotations[0].comment",
    );
    expect(formatPath(["title"], "zt")).toBe("zt.title");
    expect(formatPath([0], "zt")).toBe("zt[0]");
  });

  it("formats an empty path", () => {
    expect(formatPath([])).toBe("");
  });

  it("quotes a string segment that is not a valid identifier", () => {
    expect(formatPath(["archive-location"], "zt")).toBe(
      'zt["archive-location"]',
    );
  });

  it("quotes a segment containing a space", () => {
    expect(formatPath(["a segment"], "zt")).toBe('zt["a segment"]');
  });

  it("quotes a segment containing a double quote", () => {
    expect(formatPath(['weird"key'], "zt")).toBe('zt["weird\\"key"]');
  });

  it("quotes non-identifier segments nested after array indices", () => {
    expect(formatPath(["tags", 0, "archive-location"], "zt")).toBe(
      'zt.tags[0]["archive-location"]',
    );
  });

  it("bare-renders a non-identifier segment when it is first with no root", () => {
    expect(formatPath(["archive-location"])).toBe('["archive-location"]');
  });
});

describe("copyValue", () => {
  function valueNode(
    overrides: Partial<Extract<DisplayNode, { kind: "value" }>>,
  ): DisplayNode {
    return {
      kind: "value",
      path: ["x"],
      key: "x",
      label: "x",
      valueType: "string",
      value: "",
      expandable: false,
      ...overrides,
    } as DisplayNode;
  }

  it("returns a string value verbatim", () => {
    expect(copyValue(valueNode({ valueType: "string", value: "hello" }))).toBe(
      "hello",
    );
  });

  it("stringifies a number value", () => {
    expect(copyValue(valueNode({ valueType: "number", value: 12 }))).toBe("12");
  });

  it("stringifies a boolean value", () => {
    expect(copyValue(valueNode({ valueType: "boolean", value: true }))).toBe(
      "true",
    );
  });

  it("renders null as the literal 'null'", () => {
    expect(copyValue(valueNode({ valueType: "null", value: null }))).toBe(
      "null",
    );
  });

  it("renders undefined as the literal 'undefined'", () => {
    expect(
      copyValue(valueNode({ valueType: "undefined", value: undefined })),
    ).toBe("undefined");
  });

  it("renders an object as 2-space JSON", () => {
    expect(copyValue(valueNode({ valueType: "object", value: { a: 1 } }))).toBe(
      JSON.stringify({ a: 1 }, null, 2),
    );
  });

  it("renders an array as 2-space JSON", () => {
    expect(copyValue(valueNode({ valueType: "array", value: [1, 2] }))).toBe(
      JSON.stringify([1, 2], null, 2),
    );
  });

  it("drops a cyclic reference instead of throwing", () => {
    const obj: Record<string, unknown> = { a: 1 };
    obj.self = obj;
    const result = copyValue(valueNode({ valueType: "object", value: obj }));
    expect(() => JSON.parse(result!)).not.toThrow();
    expect(JSON.parse(result!)).toEqual({ a: 1 });
  });

  it("returns null for an unevaluated getter", () => {
    expect(
      copyValue(valueNode({ valueType: "getter", value: undefined })),
    ).toBeNull();
  });

  it("stringifies an opaque value", () => {
    class Stamp {
      toString() {
        return "2020-01-01";
      }
    }
    expect(
      copyValue(valueNode({ valueType: "opaque", value: new Stamp() })),
    ).toBe("2020-01-01");
  });

  it("returns a helper's evaluated rendering", () => {
    const node: DisplayNode = {
      kind: "helper",
      path: ["greet"],
      key: "greet",
      label: "greet",
      signatureHint: "ƒ()",
      evaluated: "hello",
    };
    expect(copyValue(node)).toBe("hello");
  });

  it("returns null for a helper with a null evaluated rendering", () => {
    const node: DisplayNode = {
      kind: "helper",
      path: ["boom"],
      key: "boom",
      label: "boom",
      signatureHint: "ƒ()",
      evaluated: null,
    };
    expect(copyValue(node)).toBeNull();
  });

  it("returns null for a placeholder node", () => {
    const node: DisplayNode = {
      kind: "placeholder",
      path: ["link"],
      key: "link",
      label: "link",
      reason: "Not imported",
    };
    expect(copyValue(node)).toBeNull();
  });
});

describe("findAnnotationRoot", () => {
  it("finds the annotation whose key matches", () => {
    const a1 = { key: "A1" };
    const a2 = { key: "A2" };
    const context = { annotations: [a1, a2] };

    expect(findAnnotationRoot(context, "A2")).toBe(a2);
  });

  it("returns null when no annotation has the given key", () => {
    const context = { annotations: [{ key: "A1" }] };

    expect(findAnnotationRoot(context, "missing")).toBeNull();
  });
});

describe("annotationKeyAtPath", () => {
  const context = {
    annotations: [{ key: "A1" }],
    attachments: [{ key: "X1" }],
  };

  it('returns the key for ["annotations", i]', () => {
    expect(annotationKeyAtPath(context, ["annotations", 0])).toBe("A1");
  });

  it('returns null for ["annotations"] with no index', () => {
    expect(annotationKeyAtPath(context, ["annotations"])).toBeNull();
  });

  it("returns null for a deeper path under an annotation", () => {
    expect(
      annotationKeyAtPath(context, ["annotations", 0, "comment"]),
    ).toBeNull();
  });

  it("returns null for a different array property", () => {
    expect(annotationKeyAtPath(context, ["attachments", 0])).toBeNull();
  });

  it("returns null for an out-of-range index", () => {
    expect(annotationKeyAtPath(context, ["annotations", 99])).toBeNull();
  });

  it("returns null for an empty path", () => {
    expect(annotationKeyAtPath(context, [])).toBeNull();
  });
});

describe("annotation re-anchoring integration", () => {
  it("builds a display tree rooted at the annotation, with annotation-relative paths", () => {
    let getCalls = 0;
    const annotation: Record<string, unknown> & { key: string } = {
      key: "A1",
      comment: "hi",
    };
    Object.defineProperty(annotation, "parentItem", {
      enumerable: true,
      get: () => {
        getCalls++;
        return { title: "Parent" };
      },
    });
    const context = { title: "T", annotations: [annotation] };

    const anchor = findAnnotationRoot(context, "A1");
    expect(anchor).toBe(annotation);

    const nodes = buildDisplayTree(anchor!, { expanded: new Set() });

    const commentNode = nodes.find((n) => n.label === "comment");
    expect(commentNode).toMatchObject({
      path: ["comment"],
      key: "comment",
      value: "hi",
    });
    expect(formatPath(commentNode!.path, "zt")).toBe("zt.comment");

    const parentItemNode = nodes.find((n) => n.label === "parentItem");
    expect(parentItemNode).toMatchObject({
      kind: "value",
      valueType: "getter",
      expandable: true,
    });
    expect(parentItemNode).not.toHaveProperty("children");
    expect(getCalls).toBe(0);
  });
});

describe("buildFilteredDisplayTree — key name matching", () => {
  it("finds a node by property name substring", () => {
    const root = { pageLabel: "42", title: "Hello" };
    const { nodes, matchedKeys } = buildFilteredDisplayTree(root, "pageLabel");

    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ label: "pageLabel", value: "42" });
    expect(matchedKeys.has("pageLabel")).toBe(true);
  });

  it("matches case-insensitively", () => {
    const root = { pageLabel: "42", title: "Hello" };
    const { nodes } = buildFilteredDisplayTree(root, "PAGELABEL");

    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ label: "pageLabel" });
  });

  it("matches partial key name", () => {
    const root = { pageLabel: "42", title: "Hello" };
    const { nodes } = buildFilteredDisplayTree(root, "page");

    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ label: "pageLabel" });
  });
});

describe("buildFilteredDisplayTree — value matching", () => {
  it("finds a node by stringified primitive value", () => {
    const root = { firstName: "Smith", lastName: "Jones" };
    const { nodes, matchedKeys } = buildFilteredDisplayTree(root, "Smith");

    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ label: "firstName", value: "Smith" });
    expect(matchedKeys.has("firstName")).toBe(true);
  });

  it("matches numeric values as strings", () => {
    const root = { count: 42, name: "x" };
    const { nodes } = buildFilteredDisplayTree(root, "42");

    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ label: "count", value: 42 });
  });

  it("matches boolean values", () => {
    const root = { active: true, name: "x" };
    const { nodes } = buildFilteredDisplayTree(root, "true");

    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ label: "active", value: true });
  });

  it("matches null values", () => {
    const root = { missing: null, name: "x" };
    const { nodes } = buildFilteredDisplayTree(root, "null");

    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ label: "missing", value: null });
  });
});

describe("buildFilteredDisplayTree — ancestor auto-expansion", () => {
  it("auto-expands ancestors of a deep match", () => {
    const root = { creators: [{ lastName: "Smith" }], title: "x" };
    const { nodes, matchedKeys } = buildFilteredDisplayTree(root, "Smith");

    expect(nodes).toHaveLength(1);
    const creatorsNode = nodes[0]!;
    expect(creatorsNode).toMatchObject({
      label: "creators",
      valueType: "array",
    });
    expect(creatorsNode.kind).toBe("value");
    if (creatorsNode.kind !== "value") throw new Error("unexpected");

    expect(creatorsNode.children).toHaveLength(1);
    const itemNode = creatorsNode.children![0]!;
    expect(itemNode.kind).toBe("value");
    if (itemNode.kind !== "value") throw new Error("unexpected");

    expect(itemNode.children).toHaveLength(1);
    expect(itemNode.children![0]).toMatchObject({
      label: "lastName",
      value: "Smith",
    });

    expect(matchedKeys.has("creators[0].lastName")).toBe(true);
    expect(matchedKeys.has("creators")).toBe(false);
    expect(matchedKeys.has("creators[0]")).toBe(false);
  });

  it("hides non-matching siblings at every level", () => {
    const root = {
      creators: [{ lastName: "Smith", firstName: "John" }],
      title: "Unrelated",
    };
    const { nodes } = buildFilteredDisplayTree(root, "Smith");

    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ label: "creators" });

    const creatorsNode = nodes[0]!;
    if (creatorsNode.kind !== "value") throw new Error("unexpected");
    const itemNode = creatorsNode.children![0]!;
    if (itemNode.kind !== "value") throw new Error("unexpected");

    expect(itemNode.children).toHaveLength(1);
    expect(itemNode.children![0]).toMatchObject({ label: "lastName" });
  });
});

describe("buildFilteredDisplayTree — container label match", () => {
  it("shows a container whose label matches, with filtered children", () => {
    const root = { creators: [{ lastName: "Smith" }], title: "x" };
    const { nodes, matchedKeys } = buildFilteredDisplayTree(root, "creators");

    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ label: "creators" });
    expect(matchedKeys.has("creators")).toBe(true);
  });

  it("shows a matched container even when it is empty", () => {
    const root = { items: [], title: "x" };
    const { nodes, matchedKeys } = buildFilteredDisplayTree(root, "items");

    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({
      label: "items",
      valueType: "array",
      expandable: false,
      size: 0,
    });
    expect(matchedKeys.has("items")).toBe(true);
  });
});

describe("buildFilteredDisplayTree — helpers and placeholders", () => {
  it("includes a helper whose label matches", () => {
    const greet = () => "hello";
    const root = { greet, other: () => "world" };
    const { nodes, matchedKeys } = buildFilteredDisplayTree(root, "greet");

    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ kind: "helper", label: "greet" });
    expect(matchedKeys.has("greet")).toBe(true);
  });

  it("does not match or evaluate a helper by its rendered value", () => {
    let called = false;
    const greet = () => {
      called = true;
      return "hello world";
    };
    const root = { greet };
    const { nodes } = buildFilteredDisplayTree(root, "hello");

    expect(nodes).toHaveLength(0);
    expect(called).toBe(false);
  });

  it("includes a placeholder whose label matches", () => {
    const placeholder = markInertPlaceholder(() => "", "Not imported");
    const root = { noteLink: placeholder, title: "x" };
    const { nodes } = buildFilteredDisplayTree(root, "noteLink");

    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ kind: "placeholder", label: "noteLink" });
  });

  it("excludes a placeholder whose label does not match", () => {
    const placeholder = markInertPlaceholder(() => "", "Not imported");
    const root = { noteLink: placeholder, title: "x" };
    const { nodes } = buildFilteredDisplayTree(root, "title");

    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ label: "title" });
  });
});

describe("buildFilteredDisplayTree — getters", () => {
  it("includes a getter whose label matches without invoking it", () => {
    let called = false;
    const obj: Record<string, unknown> = { title: "x" };
    Object.defineProperty(obj, "parentItem", {
      enumerable: true,
      get: () => {
        called = true;
        return { deep: "value" };
      },
    });

    const { nodes, matchedKeys } = buildFilteredDisplayTree(obj, "parent");
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({
      label: "parentItem",
      valueType: "getter",
      expandable: true,
    });
    expect(matchedKeys.has("parentItem")).toBe(true);
    expect(called).toBe(false);
  });

  it("traverses a getter to find matching primitive descendants", () => {
    let called = false;
    const obj: Record<string, unknown> = { title: "x" };
    Object.defineProperty(obj, "parent", {
      enumerable: true,
      get: () => {
        called = true;
        return { deepField: "match" };
      },
    });

    const { nodes } = buildFilteredDisplayTree(obj, "deepField");
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ label: "parent", valueType: "object" });
    expect(nodes[0]).toHaveProperty("children.0.label", "deepField");
    expect(called).toBe(true);
  });

  it("stops at cyclic getter values", () => {
    const parent: Record<string, unknown> = { title: "Parent" };
    const child: Record<string, unknown> = { comment: "needle" };
    Object.defineProperty(child, "parentItem", {
      enumerable: true,
      get: () => parent,
    });
    parent.annotations = [child];

    const { nodes } = buildFilteredDisplayTree(child, "title");

    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ label: "parentItem" });
    expect(nodes[0]).toHaveProperty("children.0.label", "title");
  });
});

describe("buildFilteredDisplayTree — opaque values", () => {
  it("does not match an opaque object's string representation", () => {
    const root = { createdAt: new Date("2024-01-02T00:00:00.000Z") };

    const { nodes } = buildFilteredDisplayTree(root, "2024");

    expect(nodes).toHaveLength(0);
  });
});

describe("buildFilteredDisplayTree — returns empty on no match", () => {
  it("returns empty nodes and matchedKeys when nothing matches", () => {
    const root = { title: "Hello", count: 5 };
    const { nodes, matchedKeys } = buildFilteredDisplayTree(root, "zzz");

    expect(nodes).toHaveLength(0);
    expect(matchedKeys.size).toBe(0);
  });
});

describe("buildFilteredDisplayTree — dead-chevron avoidance", () => {
  it("reports expandable: false for a label-matched container with zero matching children", () => {
    const root = { creators: [{ lastName: "Smith" }], title: "x" };
    const { nodes } = buildFilteredDisplayTree(root, "creators");

    expect(nodes).toHaveLength(1);
    const creatorsNode = nodes[0]!;
    expect(creatorsNode).toMatchObject({
      label: "creators",
      expandable: false,
    });
    expect(creatorsNode).not.toHaveProperty("children");
  });

  it("reports expandable: true for a container with matching children", () => {
    const root = { creators: [{ lastName: "Smith" }], title: "x" };
    const { nodes } = buildFilteredDisplayTree(root, "Smith");

    expect(nodes).toHaveLength(1);
    const creatorsNode = nodes[0]!;
    expect(creatorsNode).toMatchObject({ label: "creators", expandable: true });
    if (creatorsNode.kind !== "value") throw new Error("unexpected");
    expect(creatorsNode.children).toHaveLength(1);
  });
});

describe("buildFilteredDisplayTree — collapsed option", () => {
  it("omits children but keeps expandable: true when the container's key is collapsed", () => {
    const root = { creators: [{ lastName: "Smith" }], title: "x" };
    const { nodes, matchedKeys } = buildFilteredDisplayTree(root, "Smith", {
      collapsed: new Set(["creators"]),
    });

    expect(nodes).toHaveLength(1);
    const creatorsNode = nodes[0]!;
    expect(creatorsNode).toMatchObject({ label: "creators", expandable: true });
    expect(creatorsNode).not.toHaveProperty("children");
    // matchedKeys stays computed from the full walk, regardless of collapsing.
    expect(matchedKeys.has("creators[0].lastName")).toBe(true);
  });

  it("does not affect a container whose key is not in the collapsed set", () => {
    const root = { creators: [{ lastName: "Smith" }], title: "x" };
    const { nodes } = buildFilteredDisplayTree(root, "Smith", {
      collapsed: new Set(["some.other.key"]),
    });

    const creatorsNode = nodes[0]!;
    expect(creatorsNode).toMatchObject({ label: "creators", expandable: true });
    if (creatorsNode.kind !== "value") throw new Error("unexpected");
    expect(creatorsNode.children).toHaveLength(1);
  });
});

describe("buildFilteredDisplayTree — works at annotation root", () => {
  it("filters an annotation-rooted tree the same way", () => {
    const annotation = {
      key: "A1",
      comment: "Smith wrote this",
      pageLabel: "5",
    };
    const { nodes, matchedKeys } = buildFilteredDisplayTree(
      annotation,
      "Smith",
    );

    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({
      label: "comment",
      value: "Smith wrote this",
    });
    expect(matchedKeys.has("comment")).toBe(true);
  });
});
