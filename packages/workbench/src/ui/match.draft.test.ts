import { expect, it } from "vitest";

import { moveAt } from "./match.draft";
import type { ConditionGroup, ExpressionCondition } from "./match.draft";

type Tree = ConditionGroup<ExpressionCondition>;

const row = (text: string): ExpressionCondition => ({
  kind: "expression",
  text,
});

/** A, B, C at the top, then a "Match any" group of X and Y. */
const tree: Tree = {
  kind: "group",
  match: "all",
  conditions: [
    row("A"),
    row("B"),
    row("C"),
    { kind: "group", match: "any", conditions: [row("X"), row("Y")] },
  ],
};

/** The tree as text: rows by their text, groups as nested lists. */
function shape(group: Tree): unknown[] {
  return group.conditions.map((node) =>
    node.kind === "group" ? shape(node) : node.text,
  );
}

it("moves a row down its own group, counting places without the row", () => {
  expect(shape(moveAt(tree, [0], { group: [], index: 2 }))).toEqual([
    "B",
    "C",
    "A",
    ["X", "Y"],
  ]);
});

it("moves a row up its own group", () => {
  expect(shape(moveAt(tree, [2], { group: [], index: 0 }))).toEqual([
    "C",
    "A",
    "B",
    ["X", "Y"],
  ]);
});

it("moves a row into a later group, whose place shifts once the row leaves", () => {
  expect(shape(moveAt(tree, [0], { group: [3], index: 1 }))).toEqual([
    "B",
    "C",
    ["X", "A", "Y"],
  ]);
});

it("moves a row out of a nested group to its parent", () => {
  expect(shape(moveAt(tree, [3, 1], { group: [], index: 0 }))).toEqual([
    "Y",
    "A",
    "B",
    "C",
    ["X"],
  ]);
});

it("moves a whole group, keeping its rows and match", () => {
  const next = moveAt(tree, [3], { group: [], index: 0 });
  expect(shape(next)).toEqual([["X", "Y"], "A", "B", "C"]);
  expect(next.conditions[0]).toMatchObject({ kind: "group", match: "any" });
});

it("keeps a group that the move empties, as removing its last row does", () => {
  const next = moveAt(moveAt(tree, [3, 0], { group: [], index: 0 }), [4, 0], {
    group: [],
    index: 0,
  });
  expect(shape(next)).toEqual(["Y", "X", "A", "B", "C", []]);
});

it("places a row at the end when the index is past the last place", () => {
  expect(shape(moveAt(tree, [0], { group: [3], index: 99 }))).toEqual([
    "B",
    "C",
    ["X", "Y", "A"],
  ]);
});

it("answers the same tree for a move to the row's own place", () => {
  expect(moveAt(tree, [1], { group: [], index: 1 })).toBe(tree);
});

it("answers the same tree for a group moved into itself or its descendants", () => {
  const nested: Tree = {
    kind: "group",
    match: "all",
    conditions: [
      {
        kind: "group",
        match: "any",
        conditions: [
          row("X"),
          { kind: "group", match: "all", conditions: [row("Z")] },
        ],
      },
    ],
  };
  expect(moveAt(nested, [0], { group: [0], index: 0 })).toBe(nested);
  expect(moveAt(nested, [0], { group: [0, 1], index: 0 })).toBe(nested);
});

it("answers the same tree when either path names no node", () => {
  expect(moveAt(tree, [9], { group: [], index: 0 })).toBe(tree);
  expect(moveAt(tree, [0], { group: [1], index: 0 })).toBe(tree);
  expect(moveAt(tree, [0], { group: [7], index: 0 })).toBe(tree);
});
