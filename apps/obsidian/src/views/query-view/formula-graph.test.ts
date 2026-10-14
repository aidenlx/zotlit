import { expect, it } from "vitest";

import { readersOf, readFormulas } from "./formula-graph";
import { parseQueryFile } from "./query-file";

it("runs the Formulas a view reads, with those they read in turn", () => {
  const file = parseQueryFile(`formulas:
  year: date.year
  next: formula.year + 1
  label: '"formula.year"'
  unused: title
views:
  - type: table
    name: Items
    from: items
`);
  expect(
    readFormulas(file, ["title", "formula.next", "formula.label"], undefined),
  ).toEqual({
    next: "formula.year + 1",
    year: "date.year",
    label: '"formula.year"',
  });
  expect(readersOf(file.formulas!, "year")).toEqual(["next"]);
});
