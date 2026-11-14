import { describe, expect, it } from "vitest";

import { columnMenuEntries } from "./column-menu";
import type { ColumnMenuInput } from "./column-menu";

const ALL = {
  properties: true,
  group: true,
  columnWidth: true,
  propertyPages: true,
};

/** A middle column at its auto width in a view that sorts and groups by nothing. */
const BASE: ColumnMenuInput = {
  path: "title",
  kind: "field",
  at: 1,
  count: 3,
  rtl: false,
  sized: false,
  can: ALL,
  sortable: true,
  sort: [],
  groupBy: undefined,
  grouping: null,
};

/** The entries as `action` with their marks, one array per group. */
const read = (input: Partial<ColumnMenuInput>) =>
  columnMenuEntries({ ...BASE, ...input }).map((group) =>
    group.map(
      ({ action, disabled, checked }) =>
        action + (disabled ? " (disabled)" : "") + (checked ? " ✓" : ""),
    ),
  );

describe("columnMenuEntries", () => {
  it("lays out the Bases column menu, with the moves a drag makes between the hide and the sorts", () => {
    expect(read({})).toEqual([
      ["hide"],
      ["move-left", "move-right", "reset-width (disabled)"],
      ["sort-asc", "sort-desc"],
      ["edit-property"],
    ]);
  });

  it("offers Group by only for a property the dataset groups by, checked while the view groups by it", () => {
    expect(read({ path: "tags", grouping: "tags[]" })[0]).toEqual([
      "hide",
      "group",
    ]);
    expect(
      read({
        path: "tags",
        grouping: "tags[]",
        groupBy: { property: "tags[]", direction: "DESC" },
      })[0],
    ).toEqual(["hide", "group ✓"]);
  });

  it("disables the move toward an edge the column stands at, in either direction", () => {
    expect(read({ at: 0 })[1]).toEqual([
      "move-left (disabled)",
      "move-right",
      "reset-width (disabled)",
    ]);
    // Right to left, the first column stands at the right edge.
    expect(read({ at: 0, rtl: true })[1]).toEqual([
      "move-left",
      "move-right (disabled)",
      "reset-width (disabled)",
    ]);
    expect(read({ at: 2, sized: true })[1]).toEqual([
      "move-left",
      "move-right (disabled)",
      "reset-width",
    ]);
  });

  it("checks the column's sort direction and offers Clear sort while it sorts", () => {
    expect(
      read({ sort: [{ property: "title", direction: "DESC" }] })[2],
    ).toEqual(["sort-asc", "sort-desc ✓", "clear-sort"]);
    // Another column's sort checks nothing here.
    expect(read({ sort: [{ property: "date", direction: "ASC" }] })[2]).toEqual(
      ["sort-asc", "sort-desc"],
    );
  });

  it("disables the sorts of a column ZotLit Query cannot sort by, but still clears a sort it holds", () => {
    expect(
      read({
        sortable: false,
        sort: [{ property: "title", direction: "ASC" }],
      })[2],
    ).toEqual(["sort-asc (disabled) ✓", "sort-desc (disabled)", "clear-sort"]);
  });

  it("names a Formula's page Edit formula", () => {
    expect(read({ kind: "formula" }).at(-1)).toEqual(["edit-formula"]);
  });

  it("leaves out what the host cannot save, and the groups left empty", () => {
    expect(
      read({
        can: {
          properties: false,
          group: false,
          columnWidth: false,
          propertyPages: false,
        },
        grouping: "itemType",
      }),
    ).toEqual([
      ["move-left", "move-right"],
      ["sort-asc", "sort-desc"],
    ]);
  });
});
