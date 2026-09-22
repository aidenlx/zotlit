import { expect, it } from "vitest";

import { toggledValues, visibleRows } from "./chooser-logic";
import type { ChooserMatcher, ChooserRow } from "./chooser-logic";

/** A tag vocabulary in the order the Annotation View derives it. */
const ROWS: ChooserRow[] = [
  { value: "method", label: "method" },
  { value: "theory", label: "theory" },
  { value: "review", label: "review" },
  { value: "draft", label: "draft" },
];

/**
 * Three of the four rows match, and their scores rank them in the reverse of
 * the order they arrive in — Obsidian's fuzzy scores rise toward zero, so a
 * list sorted by score best-first would read "review, theory, method". The
 * fixture is built that way on purpose: source order and score order cannot
 * both be satisfied, so an implementation that ranks by score fails here.
 */
const SCORES = new Map([
  ["method", -3],
  ["theory", -2],
  ["review", -1],
]);

const scoresAgainstSourceOrder: ChooserMatcher = (text) => {
  const score = SCORES.get(text);
  return score === undefined ? null : { score };
};

const labelsOf = (rows: readonly ChooserRow[]) => rows.map((row) => row.label);

it("shows every row for the empty query", () => {
  expect(labelsOf(visibleRows(ROWS, null))).toEqual([
    "method",
    "theory",
    "review",
    "draft",
  ]);
});

it("keeps matching rows in source order, not in score order", () => {
  expect(labelsOf(visibleRows(ROWS, scoresAgainstSourceOrder))).toEqual([
    "method",
    "theory",
    "review",
  ]);
});

it("leaves nothing standing when a query matches no row", () => {
  expect(visibleRows(ROWS, () => null)).toEqual([]);
});

it("leaves the rows themselves untouched", () => {
  visibleRows(ROWS, scoresAgainstSourceOrder);
  expect(labelsOf(ROWS)).toEqual(["method", "theory", "review", "draft"]);
});

it("appends a value the selection does not hold", () => {
  expect(toggledValues(["theory"], "draft")).toEqual(["theory", "draft"]);
});

it("drops a value the selection already holds, keeping the rest in order", () => {
  expect(toggledValues(["method", "theory", "review"], "theory")).toEqual([
    "method",
    "review",
  ]);
});

it("returns a fresh collection rather than editing the one it was given", () => {
  const selected = ["method"];
  expect(toggledValues(selected, "draft")).not.toBe(selected);
  expect(selected).toEqual(["method"]);
});
