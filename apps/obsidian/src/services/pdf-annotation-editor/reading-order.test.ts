import { describe, expect, it } from "vitest";

import { annotation } from "./__fixtures__";
import { readingOrder, stepReadingOrder } from "./reading-order";

/**
 * Four Annotations whose reading order is known by hand. PDF user space counts
 * up from the bottom of the page, so the largest `y` is the top of it:
 *
 * ```text
 *   page 0                      page 1
 *   ┌──────────────────────┐    ┌──────────────────────┐
 *   │ [FIRST ] [SECOND]    │    │                      │
 *   │  y 700    y 700      │    │      [FOURTH]        │
 *   │  x 100    x 300      │    │       y 500          │
 *   │                      │    │                      │
 *   │ [THIRD]  y 400       │    │                      │
 *   └──────────────────────┘    └──────────────────────┘
 * ```
 */
const FIRST = annotation("AAAA1111", "highlight", {
  pageIndex: 0,
  rects: [[100, 690, 200, 700]],
});
const SECOND = annotation("BBBB2222", "highlight", {
  pageIndex: 0,
  rects: [[300, 690, 400, 700]],
});
const THIRD = annotation("CCCC3333", "underline", {
  pageIndex: 0,
  rects: [[100, 390, 200, 400]],
});
const FOURTH = annotation("DDDD4444", "note", {
  pageIndex: 1,
  rects: [[250, 490, 270, 500]],
});

/** The whole document, handed over in the order a list route happened to answer. */
const SHUFFLED = [FOURTH, THIRD, FIRST, SECOND];
const ORDER = ["AAAA1111", "BBBB2222", "CCCC3333", "DDDD4444"];

describe("readingOrder", () => {
  it("walks the pages in turn, then down each page, then across it", () => {
    expect(readingOrder(SHUFFLED)).toEqual(ORDER);
  });

  it("seats an ink stroke by the top left of the box its paths cover", () => {
    const ink = annotation("EEEE5555", "ink", {
      pageIndex: 0,
      width: 2,
      paths: [[420, 660, 460, 695]],
    });
    // Its highest point is y 695, below the two at y 700 and above y 400.
    expect(readingOrder([...SHUFFLED, ink])).toEqual([
      "AAAA1111",
      "BBBB2222",
      "EEEE5555",
      "CCCC3333",
      "DDDD4444",
    ]);
  });

  it("seats a quote spilled over a page break on the page it starts on", () => {
    const spilled = annotation("FFFF6666", "highlight", {
      pageIndex: 0,
      rects: [[100, 190, 500, 200]],
      nextPageRects: [[100, 690, 500, 700]],
    });
    expect(readingOrder([spilled, FOURTH])).toEqual(["FFFF6666", "DDDD4444"]);
  });

  it("leaves out an Annotation this build draws nowhere", () => {
    const epub = annotation("GGGG7777", "highlight", {
      type: "FragmentSelector",
      value: "epubcfi(/6/4!/4/2/2)",
    });
    expect(readingOrder([FIRST, epub])).toEqual(["AAAA1111"]);
  });
});

describe("stepReadingOrder", () => {
  it("enters the list from the end the key points from", () => {
    expect(stepReadingOrder(ORDER, null, 1)).toBe("AAAA1111");
    expect(stepReadingOrder(ORDER, null, -1)).toBe("DDDD4444");
  });

  it("walks one step at a time", () => {
    expect(stepReadingOrder(ORDER, "BBBB2222", 1)).toBe("CCCC3333");
    expect(stepReadingOrder(ORDER, "BBBB2222", -1)).toBe("AAAA1111");
  });

  it("wraps at both ends", () => {
    expect(stepReadingOrder(ORDER, "DDDD4444", 1)).toBe("AAAA1111");
    expect(stepReadingOrder(ORDER, "AAAA1111", -1)).toBe("DDDD4444");
  });

  it("answers nothing while there is nothing to walk", () => {
    expect(stepReadingOrder([], null, 1)).toBeNull();
  });

  it("enters the list from the end when what is selected is no longer in it", () => {
    expect(stepReadingOrder(ORDER, "ZZZZ9999", 1)).toBe("AAAA1111");
  });
});
