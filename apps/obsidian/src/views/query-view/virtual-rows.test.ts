import { describe, expect, it } from "vitest";

import { flow, learn, withPinned } from "./virtual-rows";

describe("flow", () => {
  it("leaves the room of the entries before, between and after the drawn ones", () => {
    // The list starts 40 px into the scroller; rows are 10 px.
    expect(
      flow(
        [
          { index: 3, start: 70, end: 80 },
          { index: 4, start: 80, end: 90 },
          { index: 9, start: 130, end: 140 },
        ],
        40,
        240,
      ),
    ).toEqual({
      entries: [
        { index: 3, before: 30 },
        { index: 4, before: 0 },
        { index: 9, before: 40 },
      ],
      after: 100,
    });
  });

  it("leaves the whole list as room where nothing is drawn", () => {
    expect(flow([], 0, 500)).toEqual({ entries: [], after: 500 });
  });
});

describe("withPinned", () => {
  const range = { startIndex: 10, endIndex: 12, overscan: 1, count: 100 };

  it("adds the pinned entries to the range, in order", () => {
    expect(withPinned(range, [50, 0])).toEqual([0, 9, 10, 11, 12, 13, 50]);
  });

  it("drops a pinned entry the list no longer holds", () => {
    expect(withPinned(range, [-1, 100, 11])).toEqual([9, 10, 11, 12, 13]);
  });
});

describe("learn", () => {
  it("takes the median height of each kind with five measured entries", () => {
    const rows = [31, 31, 30, 52, 31].map((size) => ({ kind: "row", size }));
    const headings = [38, 38].map((size) => ({ kind: "heading", size }));
    expect(learn([...rows, ...headings])).toEqual(new Map([["row", 31]]));
  });
});
