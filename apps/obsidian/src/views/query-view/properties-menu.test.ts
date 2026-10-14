import { describe, expect, it } from "vitest";

import { chooserLayout } from "@/components/chooser-logic";
import type { ChooserMatcher } from "@/components/chooser-logic";

import { propertyRow } from "./properties-menu";
import { parseQueryFile } from "./query-file";
import { viewProperties } from "./view-properties";

const FILE = parseQueryFile(`formulas:
  year: date.year
properties:
  title:
    displayName: Work
  formula.year:
    displayName: Year of source
views:
  - type: table
    name: Items
    from: items
`);

/** The rows a search for `query` leaves, as a case-blind substring match. */
function search(rows: ReturnType<typeof propertyRow>[], query: string) {
  const matcher: ChooserMatcher = (text) =>
    text.toLowerCase().includes(query.toLowerCase()) ? { score: 0 } : null;
  return chooserLayout([{ items: rows }], matcher).rows.map((row) => row.value);
}

describe("propertyRow", () => {
  const properties = viewProperties(FILE, FILE.views[0]!);
  const rows = properties.entries.map(propertyRow);

  it("finds a property by its Display Name, its field label and its path, visible or not", () => {
    expect(properties.entry("formula.year").place).toBe(null);
    expect(search(rows, "Work")).toContain("title");
    expect(search(rows, "Work")).not.toContain("shortTitle");
    expect(search(rows, "Year of source")).toEqual(["formula.year"]);
    expect(search(rows, "formula.year")).toEqual(["formula.year"]);
    expect(search(rows, "title")).toEqual(
      expect.arrayContaining(["title", "shortTitle"]),
    );
  });
});
