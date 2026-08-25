import { describe, expect, it } from "vitest";

import { renderContractTableMarkdown } from "./gfm.ts";
import { buildPageModel } from "./page-model.ts";
import { IR, SPECS } from "./test-fixtures.ts";

const model = buildPageModel(IR, SPECS);

describe("renderContractTableMarkdown", () => {
  it("renders the prefixed root table with header, delimiter, and prefixed rows", () => {
    const table = renderContractTableMarkdown(model, "root");

    expect(table).toContain("| Property | Type | Description |");
    expect(table).toContain("| --- | --- | --- |");
    expect(table).toContain("| `zt.name` | `string` |");
    expect(table).toContain("| `zt.label?` | `string \\| null` |");
  });

  it("links a row's type to the section documenting it", () => {
    const table = renderContractTableMarkdown(model, "root");

    expect(table).toContain("| `zt.leaves` | [`Leaf[]`](#leaf) |");
  });

  it("escapes pipes in a full type so the row keeps three cells", () => {
    const table = renderContractTableMarkdown(model, "leaf");
    const row = table.split("\n").find((line) => line.startsWith("| `kind`"))!;

    expect(row).toContain('"a" \\| "b" \\| "c" \\| "d"');
    // Split on unescaped pipes alone: an unescaped pipe in a cell adds one.
    expect(row.split(/(?<!\\)\|/).slice(1, -1)).toHaveLength(3);
  });

  it("presents helper signature, engine usage, filter, and example notes in a row", () => {
    const table = renderContractTableMarkdown(model, "leaf");
    const row = table.split("\n").find((line) => line.startsWith("| `link`"))!;

    expect(row).toContain(
      "Signature: `(alias?: string, subpath?: string) => string`.",
    );
    expect(row).toContain("Liquid: `{{ leaf.link }}`.");
    expect(row).toContain("Eta: `<%= leaf.link(alias, subpath) %>`.");
    expect(row).toContain(
      "Liquid filter: `{{ leaf \\| leaf_link: alias, subpath }}`.",
    );
    expect(row).toContain("Example: `{{ leaf.link }}`.");
  });

  it("links a root-scoped reference row back to the root section", () => {
    const table = renderContractTableMarkdown(model, "leaf");

    expect(table).toContain("| `owner` | [`zt`](#root) |");
  });

  it("emits one table per type with its caption, in order", () => {
    const table = renderContractTableMarkdown(model, "pair");
    const first = table.indexOf("**First**");
    const second = table.indexOf("**Second**");

    expect(first).toBeGreaterThanOrEqual(0);
    expect(second).toBeGreaterThan(first);
    expect(table).toContain("| `year` | `number` | Year. |");
  });

  it("renders the item-type map as an Item type / Fields table", () => {
    const table = renderContractTableMarkdown(model, "item-types");

    expect(table).toContain("| Item type | Fields |");
    expect(table).toContain("| --- | --- |");
    expect(table).toContain("| `book` | `title`, `publisher` |");
  });

  it("throws on an unknown section id", () => {
    expect(() => renderContractTableMarkdown(model, "missing")).toThrow(
      /No contract section missing/,
    );
  });
});
