import { describe, expect, it } from "vitest";

import { flow, leadOf, learn, withLead, withPinned } from "./virtual-rows";

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

describe("withLead", () => {
  // Rows of 10 px; the screen shows rows 10 to 12.
  const places = Array.from({ length: 100 }, (_, i) => ({
    start: i * 10,
    end: i * 10 + 10,
  }));
  const range = { startIndex: 10, endIndex: 12, overscan: 1, count: 100 };

  const scroll = (direction: "forward" | "backward" | null, lead: number) => ({
    measurements: places,
    direction,
    lead,
  });

  it("mounts the room ahead of a scroll down", () => {
    expect(withLead(range, scroll("forward", 25))).toEqual({
      ...range,
      endIndex: 15,
    });
  });

  it("mounts the room ahead of a scroll up", () => {
    expect(withLead(range, scroll("backward", 25))).toEqual({
      ...range,
      startIndex: 7,
    });
  });

  it("stops at the ends of the list", () => {
    expect(withLead(range, scroll("forward", 10_000)).endIndex).toBe(99);
    expect(withLead(range, scroll("backward", 10_000)).startIndex).toBe(0);
  });

  it("keeps the range while the list does not scroll", () => {
    expect(withLead(range, scroll(null, 25))).toBe(range);
  });
});

describe("leadOf", () => {
  it("leads a scroll by four of its steps, up to two screens", () => {
    expect(leadOf(100, 700)).toBe(400);
    expect(leadOf(600, 700)).toBe(1400);
  });

  it("leads no scroll of a screen or more a step, nor a stopped one", () => {
    expect(leadOf(700, 700)).toBe(0);
    expect(leadOf(0, 700)).toBe(0);
  });
});
