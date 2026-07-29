import { describe, expect, it } from "vitest";

import { type ContractIR } from "./ir.ts";
import { buildPageModel, type RowModel } from "./page-model.ts";
import { type SectionSpec } from "./sections.ts";

const SPECS: readonly SectionSpec[] = [
  {
    id: "root",
    title: "Root",
    level: 2,
    types: ["Root"],
    sample: "zt",
    prefix: "zt.",
  },
  { id: "leaf", title: "Leaf", level: 2, types: ["Leaf"], sample: "leaf" },
];

const IR: ContractIR = {
  $comment: "test",
  contractVersion: 1,
  roots: {
    note: {
      type: "Root",
      templates: ["note"],
      references: [{ owner: "Leaf", member: "owner", path: "zt" }],
    },
  },
  itemTypes: { book: ["title", "publisher"] },
  types: {
    Root: {
      kind: "object",
      description:
        "The `zt` root: a {@link Leaf} reached through\n{@link Root.leaves}.\n\nSee {@link Missing} for the rest.",
      members: [
        {
          name: "leaves",
          description: "Every leaf, sorted by {@link name}.",
          optional: false,
          type: { kind: "array", items: { kind: "ref", name: "Leaf" } },
        },
        {
          name: "label",
          description: "The label.",
          optional: true,
          type: {
            kind: "union",
            options: [
              { kind: "primitive", type: "string" },
              { kind: "primitive", type: "null" },
            ],
          },
        },
        {
          name: "name",
          optional: false,
          type: { kind: "primitive", type: "string" },
        },
      ],
    },
    Leaf: {
      kind: "object",
      description: "One leaf.",
      members: [
        {
          name: "owner",
          description: "The item this leaf hangs off.",
          optional: false,
          type: { kind: "ref", name: "Root" },
        },
        {
          name: "kind",
          description: "Leaf kind.",
          optional: false,
          type: {
            kind: "union",
            options: [
              { kind: "literal", value: "a" },
              { kind: "literal", value: "b" },
              { kind: "literal", value: "c" },
              { kind: "literal", value: "d" },
            ],
          },
        },
        {
          name: "link",
          description: "Wiki-link to the leaf.",
          optional: false,
          examples: [{ lang: "liquid", code: "{{ leaf.link }}" }],
          type: {
            kind: "union",
            options: [
              {
                kind: "helper",
                name: "link",
                signature: "(alias?: string, subpath?: string) => string",
                filter: "leaf_link",
                value: { kind: "primitive", type: "string" },
              },
              { kind: "primitive", type: "null" },
            ],
          },
        },
      ],
    },
  },
};

function rowOf(sectionId: string, name: string): RowModel {
  const section = buildPageModel(IR, SPECS).sections.find(
    (entry) => entry.id === sectionId,
  );
  const row = section?.tables[0]?.rows.find((entry) => entry.name === name);
  if (!row) throw new Error(`No ${sectionId}.${name} row`);
  return row;
}

describe("doc normalization", () => {
  it("rejoins wrapped lines and keeps paragraph breaks", () => {
    const { description } = buildPageModel(IR, SPECS).sections[0]!;

    expect(description).toHaveLength(2);
    expect(description[0]!.map((node) => node.kind)).toEqual([
      "text",
      "code",
      "text",
      "link",
      "text",
      "link",
      "text",
    ]);
    expect(description[0]![4]).toEqual({
      kind: "text",
      value: " reached through ",
    });
  });

  it("splits a Markdown code span into its own run", () => {
    const [paragraph] = buildPageModel(IR, SPECS).sections[0]!.description;

    expect(paragraph![1]).toEqual({ kind: "code", value: "zt" });
  });

  it("warns on an undocumented member and leaves its description empty", () => {
    const { warnings } = buildPageModel(IR, SPECS);

    expect(warnings).toEqual(["Root.name has no description"]);
    expect(rowOf("root", "name").description).toEqual([]);
  });
});

describe("link resolution", () => {
  it("links a type target to its section", () => {
    const [paragraph] = buildPageModel(IR, SPECS).sections[0]!.description;

    expect(paragraph![3]).toEqual({
      kind: "link",
      href: "#leaf",
      text: "Leaf",
      code: true,
    });
  });

  it("links a qualified member target to its row", () => {
    const [paragraph] = buildPageModel(IR, SPECS).sections[0]!.description;

    expect(paragraph![5]).toEqual({
      kind: "link",
      href: "#root-leaves",
      text: "leaves",
      code: true,
    });
  });

  it("links a bare member target within the type that documents it", () => {
    expect(rowOf("root", "leaves").description[0]![1]).toEqual({
      kind: "link",
      href: "#root-name",
      text: "name",
      code: true,
    });
  });

  it("degrades a target the IR does not carry to code text", () => {
    const [, paragraph] = buildPageModel(IR, SPECS).sections[0]!.description;

    expect(paragraph![1]).toEqual({ kind: "code", value: "Missing" });
  });
});

describe("root-scoped references", () => {
  it("renders a serialized reference as a link back to its root section", () => {
    const row = rowOf("leaf", "owner");

    expect(row.shortType).toBe("zt");
    expect(row.fullType).toBe("zt");
    expect(row.typeHref).toBe("#root");
  });
});

describe("helper presentation", () => {
  it("names the signature, both engines, and the Liquid filter", () => {
    expect(rowOf("leaf", "link").helper).toEqual({
      signature: "(alias?: string, subpath?: string) => string",
      liquid: "{{ leaf.link }}",
      eta: "<%= leaf.link(alias, subpath) %>",
      filter: "{{ leaf | leaf_link: alias, subpath }}",
    });
  });

  it("collapses a helper to its plain-access type and keeps its examples", () => {
    const row = rowOf("leaf", "link");

    expect(row.shortType).toBe("string | null");
    expect(row.fullType).toBe(
      "((alias?: string, subpath?: string) => string) | null",
    );
    expect(row.examples).toEqual([{ lang: "liquid", code: "{{ leaf.link }}" }]);
  });
});

describe("rows", () => {
  it("marks an optional member and links a member's own section", () => {
    expect(rowOf("root", "label").optional).toBe(true);
    expect(rowOf("root", "name").optional).toBe(false);
    expect(rowOf("root", "leaves").typeHref).toBe("#leaf");
  });

  it("truncates a long union in the collapsed row alone", () => {
    const row = rowOf("leaf", "kind");

    expect(row.shortType).toBe('"a" | "b" | "c" | …');
    expect(row.fullType).toBe('"a" | "b" | "c" | "d"');
  });

  it("carries the section prefix and the item-type map", () => {
    const model = buildPageModel(IR, SPECS);

    expect(model.sections[0]!.tables[0]!.prefix).toBe("zt.");
    expect(model.sections[1]!.tables[0]!.prefix).toBeUndefined();
    expect(model.sections[0]!.itemTypes).toEqual([]);
  });
});

describe("page template checks", () => {
  it("fails on a contract type no section places", () => {
    expect(() => buildPageModel(IR, [SPECS[0]!])).toThrow(/Leaf/);
  });
});
