import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import ir from "./generated/ir.json";
import { buildPageModel } from "./page-model.ts";
import { SECTIONS } from "./sections.ts";

const page = readFileSync(
  join("content", "docs", "reference", "templates", "data.mdx"),
  "utf8",
);
const model = buildPageModel(ir as never);

describe("generated template-data page", () => {
  it("carries the generated-file banner and names the prose source", () => {
    expect(page).toContain("DO NOT EDIT");
    expect(page).toContain("packages/db/src/lib/context/");
    expect(ir.$comment).toMatch(/DO NOT EDIT/);
  });

  it("heads every section with its explicit anchor", () => {
    for (const { id, title, level } of SECTIONS) {
      expect(page).toContain(`${"#".repeat(level)} ${title} [#${id}]`);
    }
  });

  it("tables every Contract Root and every shape reachable from one", () => {
    const documented = new Set(
      SECTIONS.flatMap((section) => section.types ?? []),
    );

    expect(Object.keys(ir.types).every((type) => documented.has(type))).toBe(
      true,
    );
    for (const root of Object.values(ir.roots)) {
      expect(page).toContain(
        `<ContractTable section="${
          SECTIONS.find((section) => section.types?.includes(root.type))!.id
        }" />`,
      );
    }
  });

  it("inlines each hand-written partial at its own section", () => {
    for (const { include } of SECTIONS) {
      if (include) expect(page).toContain(`<include>${include}</include>`);
    }
    expect(page).toContain("<include>./_citation-templates.mdx</include>");
    expect(page).toContain("<include>./_field-aliases.mdx</include>");
    expect(page).toContain(
      "<include>./_imported-note-frontmatter.mdx</include>",
    );
  });

  it("leaves no unresolved doc-link tag in the output", () => {
    expect(page).not.toContain("{@link");
  });

  it("documents every member the contract declares", () => {
    expect(model.warnings).toEqual([]);
  });
});
