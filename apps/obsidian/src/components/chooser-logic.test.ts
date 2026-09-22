import { expect, it } from "vitest";

import {
  activatedRow,
  chooserLayout,
  clampedHighlight,
  movedHighlight,
  rehomedHighlight,
  toggledValues,
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

/** The tag Chooser's own shape: a group of tags, then a group of one action. */
const CLEAR: ChooserRow = {
  value: "zt:clear-tags",
  label: "Clear selected tags",
  action: () => {},
};
const TAGS_ONLY = [{ label: "Tags", items: ROWS }];
const GROUPS = [{ label: "Tags", items: ROWS }, { items: [CLEAR] }];

/** Matches the action row's label alone, and nothing in the tag vocabulary. */
const clearOnly: ChooserMatcher = (text) =>
  text === CLEAR.label ? { score: -1 } : null;

it("shows every row for the empty query", () => {
  expect(labelsOf(chooserLayout(TAGS_ONLY, null).rows)).toEqual([
    "method",
    "theory",
    "review",
    "draft",
  ]);
});

it("keeps matching rows in source order, not in score order", () => {
  expect(
    labelsOf(chooserLayout(TAGS_ONLY, scoresAgainstSourceOrder).rows),
  ).toEqual(["method", "theory", "review"]);
});

it("leaves the rows themselves untouched", () => {
  chooserLayout(TAGS_ONLY, scoresAgainstSourceOrder);
  expect(labelsOf(ROWS)).toEqual(["method", "theory", "review", "draft"]);
});

it("draws the groups in the order they were given", () => {
  const { sections } = chooserLayout(GROUPS, null);
  expect(sections.map((section) => section.label)).toEqual(["Tags", undefined]);
  expect(sections.map((section) => section.at)).toEqual([0, 1]);
  expect(sections.map((section) => labelsOf(section.rows))).toEqual([
    ["method", "theory", "review", "draft"],
    ["Clear selected tags"],
  ]);
});

it("walks every group's rows as one sequence", () => {
  expect(labelsOf(chooserLayout(GROUPS, null).rows)).toEqual([
    "method",
    "theory",
    "review",
    "draft",
    "Clear selected tags",
  ]);
});

it("drops a group the query empties, heading and all", () => {
  const groups = [
    { label: "Tags", items: ROWS },
    { label: "More", items: [] },
  ];
  const { sections } = chooserLayout(groups, null);
  expect(sections.map((section) => section.label)).toEqual(["Tags"]);
});

it("keeps a surviving group's place in the caller's list", () => {
  const groups = [
    { label: "Gone", items: [] },
    { label: "Tags", items: ROWS },
  ];
  expect(chooserLayout(groups, null).sections.map((s) => s.at)).toEqual([1]);
});

it("leaves an action row standing whatever the query matches", () => {
  const narrowed = chooserLayout(GROUPS, scoresAgainstSourceOrder);
  expect(labelsOf(narrowed.rows)).toEqual([
    "method",
    "theory",
    "review",
    "Clear selected tags",
  ]);
  expect(narrowed.empty).toBe(false);

  // A query naming the action itself is no search hit either: the entries
  // decide, and they came out empty.
  const onlyTheAction = chooserLayout(GROUPS, clearOnly);
  expect(labelsOf(onlyTheAction.rows)).toEqual(["Clear selected tags"]);
  expect(onlyTheAction.empty).toBe(true);
});

it("reports an empty query result while the action row still stands", () => {
  const nothing = chooserLayout(GROUPS, () => null);
  expect(nothing.sections.map((section) => section.at)).toEqual([1]);
  expect(labelsOf(nothing.rows)).toEqual(["Clear selected tags"]);
  expect(nothing.empty).toBe(true);
});

it("leaves no group standing when the query matches nothing but entries", () => {
  expect(chooserLayout(TAGS_ONLY, () => null)).toEqual({
    sections: [],
    rows: [],
    empty: true,
  });
});

it("runs the action a row carries instead of ticking it", () => {
  const ran: string[] = [];
  const close = () => ran.push("closed");
  const activation = activatedRow(
    {
      ...CLEAR,
      action: (shut) => {
        ran.push("ran");
        shut();
      },
    },
    ["method"],
  );
  expect(activation.kind).toBe("action");
  if (activation.kind === "action") activation.run(close);
  expect(ran).toEqual(["ran", "closed"]);
});

it("ticks a row that carries no action", () => {
  expect(activatedRow(ROWS[1], ["method"])).toEqual({
    kind: "select",
    values: ["method", "theory"],
  });
});

it("activates neither a disabled row nor a row that is not there", () => {
  expect(activatedRow({ ...CLEAR, disabled: true }, [])).toEqual({
    kind: "ignored",
  });
  expect(
    activatedRow({ value: "method", label: "method", disabled: true }, []),
  ).toEqual({ kind: "ignored" });
  expect(activatedRow(undefined, [])).toEqual({ kind: "ignored" });
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
