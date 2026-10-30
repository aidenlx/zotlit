import { describe, expect, it } from "vitest";

import { layoutsFor } from "./layouts";

const types = (layouts: { type: string }[]) => layouts.map(({ type }) => type);

describe("layoutsFor", () => {
  it("offers every Layout of the dataset where the host names none, the Table first for Items", () => {
    expect(types(layoutsFor({ from: "items" }))).toEqual([
      "table",
      "list",
      "cards",
      "papers",
    ]);
    expect(types(layoutsFor({ from: "annotations" }))).toEqual([
      "annotations",
      "list",
      "cards",
    ]);
  });

  it("offers only the Layouts the host names that can show the dataset, in the host's order", () => {
    expect(
      types(layoutsFor({ from: "items" }, ["papers", "table", "annotations"])),
    ).toEqual(["papers", "table"]);
  });
});
