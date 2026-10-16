import { describe, expect, it } from "vitest";

import {
  dropGap,
  gapMove,
  resizedWidth,
  withColumnWidth,
} from "./table-columns";

describe("dropGap", () => {
  // Three columns of 100px; the dragged column is the middle one.
  const WIDTHS = [100, 100, 100];

  it("drops before a column that stands before the dragged one", () => {
    expect(dropGap(WIDTHS, 1, 10)).toBe(0);
    expect(dropGap(WIDTHS, 1, 90)).toBe(0);
  });

  it("leaves the column in place over itself", () => {
    expect(dropGap(WIDTHS, 1, 150)).toBe(1);
    expect(gapMove(1, 1)).toBeNull();
  });

  it("drops after a column that stands after the dragged one", () => {
    expect(dropGap(WIDTHS, 1, 210)).toBe(3);
    expect(gapMove(1, 3)).toBe(2);
  });

  it("drops at the start before the first column and at the end past the last", () => {
    expect(dropGap(WIDTHS, 2, -20)).toBe(0);
    expect(gapMove(2, 0)).toBe(0);
    expect(dropGap(WIDTHS, 0, 900)).toBe(3);
    expect(gapMove(0, 3)).toBe(2);
  });

  it("moves the first column one place on to the second", () => {
    expect(dropGap(WIDTHS, 0, 150)).toBe(2);
    expect(gapMove(0, 2)).toBe(1);
  });
});

describe("resizedWidth", () => {
  it("follows the pointer from the width the drag started at", () => {
    expect(
      resizedWidth({ start: 200, delta: 37.4, direction: "ltr", min: 40 }),
    ).toBe(237);
    expect(
      resizedWidth({ start: 200, delta: -50, direction: "ltr", min: 40 }),
    ).toBe(150);
  });

  it("grows toward the start of the line in a right-to-left table", () => {
    expect(
      resizedWidth({ start: 200, delta: -30, direction: "rtl", min: 40 }),
    ).toBe(230);
  });

  it("stops at the narrowest column width", () => {
    expect(
      resizedWidth({ start: 200, delta: -500, direction: "ltr", min: 40 }),
    ).toBe(40);
  });
});

describe("withColumnWidth", () => {
  it("sets the width of one column and keeps the others", () => {
    expect(withColumnWidth({ title: 300 }, "date", 120)).toEqual({
      title: 300,
      date: 120,
    });
  });

  it("changes a width in its place", () => {
    expect(
      Object.keys(withColumnWidth({ title: 300, date: 120 }, "title", 200)!),
    ).toEqual(["title", "date"]);
  });

  it("removes the width of a column set back to its auto width", () => {
    expect(withColumnWidth({ title: 300, date: 120 }, "date", null)).toEqual({
      title: 300,
    });
  });

  it("removes the map with its last width", () => {
    expect(withColumnWidth({ date: 120 }, "date", null)).toBeUndefined();
    expect(withColumnWidth(undefined, "date", null)).toBeUndefined();
  });
});
