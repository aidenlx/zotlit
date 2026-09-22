import { expect, it } from "vitest";

import {
  clampedHighlight,
  movedHighlight,
  rehomedHighlight,
  toggledValues,
  visibleRows,
} from "./chooser-logic";
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

/**
 * Six rows and a page of two, so a page step and a single step can never be
 * mistaken for one another and a page from row 1 lands short of the end.
 */
const LIST = { count: 6, pageSize: 2 };

it("steps the highlight one row at a time", () => {
  expect(movedHighlight(2, "next", LIST)).toBe(3);
  expect(movedHighlight(2, "previous", LIST)).toBe(1);
});

it("wraps a single step at both ends of the list", () => {
  expect(movedHighlight(5, "next", LIST)).toBe(0);
  expect(movedHighlight(0, "previous", LIST)).toBe(5);
});

it("steps a page at a time and stops at the end rather than wrapping", () => {
  expect(movedHighlight(1, "page-down", LIST)).toBe(3);
  expect(movedHighlight(4, "page-down", LIST)).toBe(5);
  expect(movedHighlight(5, "page-down", LIST)).toBe(5);
  expect(movedHighlight(4, "page-up", LIST)).toBe(2);
  expect(movedHighlight(1, "page-up", LIST)).toBe(0);
  expect(movedHighlight(0, "page-up", LIST)).toBe(0);
});

it("takes a page of at least one row when nothing measurable fits", () => {
  expect(movedHighlight(2, "page-down", { count: 6, pageSize: 0 })).toBe(3);
});

it("jumps to the first and the last row", () => {
  expect(movedHighlight(3, "first", LIST)).toBe(0);
  expect(movedHighlight(3, "last", LIST)).toBe(5);
});

it("highlights no row while the list is empty", () => {
  const empty = { count: 0, pageSize: 2 };
  expect(movedHighlight(0, "next", empty)).toBe(-1);
  expect(movedHighlight(0, "last", empty)).toBe(-1);
  expect(clampedHighlight(0, 0)).toBe(-1);
});

it("moves from the first row when nothing is highlighted yet", () => {
  expect(movedHighlight(-1, "next", LIST)).toBe(1);
  expect(movedHighlight(-1, "previous", LIST)).toBe(5);
});

it("brings a highlight past the end of a shrunken list back to its last row", () => {
  expect(clampedHighlight(9, 3)).toBe(2);
  expect(movedHighlight(9, "next", { count: 3, pageSize: 2 })).toBe(0);
});

it("keeps the highlight on its own row when the list is rebuilt around it", () => {
  expect(rehomedHighlight("review", ROWS)).toBe(2);
});

it("takes the highlight back to the first row when its row is gone", () => {
  expect(rehomedHighlight("review", ROWS.slice(0, 2))).toBe(0);
  expect(rehomedHighlight(null, ROWS)).toBe(0);
});

it("highlights no row when the rebuilt list is empty", () => {
  expect(rehomedHighlight("review", [])).toBe(-1);
});
