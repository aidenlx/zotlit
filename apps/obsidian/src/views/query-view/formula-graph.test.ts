import { expect, it } from "vitest";

import { formulaReferences, readersOf, readFormulas } from "./formula-graph";
import { parseQueryFile } from "./query-file";

it("reads formula.<name> as the parser reads it, not inside a quoted string", () => {
  expect(
    formulaReferences('formula.year > 2000 && title == "formula.next"'),
  ).toEqual([{ name: "year", from: 0, to: 12 }]);
  expect(formulaReferences("formula.parts[0].length + formula.n")).toEqual([
    { name: "parts", from: 0, to: 13 },
    { name: "n", from: 26, to: 35 },
  ]);
  // A text that does not parse reads no Formula.
  expect(formulaReferences("formula.year +")).toEqual([]);
});

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
