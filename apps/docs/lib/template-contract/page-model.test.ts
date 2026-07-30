import { describe, expect, it } from "vitest";

import { buildPageModel, type RowModel } from "./page-model.ts";
import { IR, SPECS } from "./test-fixtures.ts";

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

    expect(warnings).toContain("Root.name has no description");
    expect(rowOf("root", "name").description).toEqual([]);
  });

  it("warns on any undocumented type, not only a section's first", () => {
    expect(buildPageModel(IR, SPECS).warnings).toContain(
      "Second has no type description",
    );
  });
});

describe("literal union options", () => {
  const section = () =>
    buildPageModel(IR, SPECS).sections.find((entry) => entry.id === "kinds")!;

  it("lists the options in declaration order with resolved descriptions", () => {
    const { values } = section();

    expect(values.map(({ value }) => value)).toEqual(["apex", "stray"]);
    expect(values[0]!.description).toEqual([
      [
        { kind: "text", value: "The topmost " },
        { kind: "link", href: "#leaf", text: "Leaf", code: true },
        { kind: "text", value: "." },
      ],
    ]);
  });

  it("warns on an undocumented option and leaves its description empty", () => {
    expect(buildPageModel(IR, SPECS).warnings).toContain(
      "Kind option stray has no description",
    );
    expect(section().values[1]!.description).toEqual([]);
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

  it("numbers a member link by the table's place in its whole section", () => {
    expect(rowOf("root", "label").description[0]![1]).toEqual({
      kind: "link",
      href: "#pair-2-year",
      text: "year",
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

  it("retargets a root-authored example at the shape the section documents", () => {
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
