import { describe, expect, it } from "vitest";

import {
  markAnchor,
  marksAtPoint,
  pagePointOf,
  resolveMarkClick,
} from "./hit-test";
import type {
  MarkClick,
  MarkClickInput,
  MarkSelectionPoint,
  PageBox,
} from "./hit-test";
import type { MarkTarget } from "./render";

/**
 * A US Letter page laid out at 100 % zoom, offset inside the reader, so page
 * units and client pixels differ by the offset alone and every expectation
 * below can be read off the seeded rectangles.
 */
const PAGE: PageBox = {
  left: 100,
  top: 50,
  width: 612,
  height: 792,
  unitWidth: 612,
  unitHeight: 792,
};

/** The same page at 200 % zoom: two client pixels are one page unit. */
const ZOOMED: PageBox = { ...PAGE, width: 1224, height: 1584 };

/** A paragraph-sized mark, and a word inside it. */
const PARAGRAPH: MarkTarget = {
  key: "PARA1111",
  rects: [[100, 100, 500, 140]],
};
const WORD: MarkTarget = { key: "WORD2222", rects: [[200, 110, 240, 130]] };
/** A second word inside the paragraph, of the same area as the first. */
const OTHER: MarkTarget = { key: "WORD3333", rects: [[300, 110, 340, 130]] };

/** A click on the page, before the modifiers and the gesture are described. */
function click(
  point: { x: number; y: number },
  {
    targets = [PARAGRAPH, WORD],
    previous = null,
    ...rest
  }: Partial<Omit<MarkClickInput, "page" | "previous">> & {
    targets?: MarkTarget[];
    previous?: MarkSelectionPoint | null;
  } = {},
): MarkClick {
  const at = pagePointOf(PAGE, point);
  return resolveMarkClick({
    page: at === null ? null : { index: 0, targets, at },
    travel: 0,
    collapsed: true,
    onLink: false,
    altKey: false,
    previous,
    ...rest,
  });
}

/** Where the click that selected `key` fell, in page units. */
function selectedAt(key: string, x: number, y: number): MarkSelectionPoint {
  return { key, pageIndex: 0, point: { x, y } };
}

describe("marksAtPoint", () => {
  it("answers the marks under the point, smallest area first", () => {
    const at = pagePointOf(PAGE, { x: 320, y: 170 })!;
    expect(marksAtPoint([PARAGRAPH, WORD], at)).toEqual([
      "WORD2222",
      "PARA1111",
    ]);
  });

  it("forgives two pixels around a mark and no more", () => {
    // The word's right edge is at 240 page units, which is client x 340.
    expect(
      marksAtPoint([WORD], pagePointOf(PAGE, { x: 342, y: 170 })!),
    ).toEqual(["WORD2222"]);
    expect(
      marksAtPoint([WORD], pagePointOf(PAGE, { x: 343, y: 170 })!),
    ).toEqual([]);
  });

  it("measures the forgiveness in pixels, so zoom does not widen it", () => {
    // At 200 %, the word's right edge is 480 pixels along the page box.
    const at = pagePointOf(ZOOMED, { x: 100 + 482, y: 50 + 240 })!;
    expect(marksAtPoint([WORD], at)).toEqual(["WORD2222"]);
    const past = pagePointOf(ZOOMED, { x: 100 + 485, y: 50 + 240 })!;
    expect(marksAtPoint([WORD], past)).toEqual([]);
  });
});

describe("pagePointOf", () => {
  it("converts a client point into the page's own units", () => {
    expect(pagePointOf(PAGE, { x: 320, y: 170 })).toEqual({
      point: { x: 220, y: 120 },
      pad: 2,
    });
    expect(pagePointOf(ZOOMED, { x: 100 + 440, y: 50 + 240 })).toEqual({
      point: { x: 220, y: 120 },
      pad: 1,
    });
  });

  it("answers nothing for a point past the page box", () => {
    expect(pagePointOf(PAGE, { x: 99, y: 170 })).not.toBeNull();
    expect(pagePointOf(PAGE, { x: 97, y: 170 })).toBeNull();
    expect(pagePointOf(PAGE, { x: 320, y: 900 })).toBeNull();
  });

  it("answers nothing for a page the reader is not showing", () => {
    expect(
      pagePointOf({ ...PAGE, width: 0, height: 0 }, { x: 0, y: 0 }),
    ).toBeNull();
  });
});

describe("markAnchor", () => {
  it("hangs the popup from the bottom centre of the union of the rects", () => {
    expect(
      markAnchor(
        [
          [100, 100, 500, 140],
          [100, 150, 300, 190],
        ],
        PAGE,
      ),
    ).toEqual({ x: 100 + 300, y: 50 + 190 });
  });

  it("answers nothing for a mark that draws nothing on this page", () => {
    expect(markAnchor([], PAGE)).toBeNull();
  });
});

describe("resolveMarkClick", () => {
  it("takes the smallest mark under a fresh click", () => {
    expect(click({ x: 320, y: 170 })).toEqual({
      kind: "select",
      key: "WORD2222",
      stack: ["WORD2222", "PARA1111"],
    });
  });

  it("steps through the stack at one point, and wraps", () => {
    const point = { x: 320, y: 170 };
    expect(
      click(point, { previous: selectedAt("WORD2222", 220, 120) }),
    ).toEqual({
      kind: "select",
      key: "PARA1111",
      stack: ["WORD2222", "PARA1111"],
    });
    expect(
      click(point, { previous: selectedAt("PARA1111", 220, 120) }),
    ).toEqual({
      kind: "select",
      key: "WORD2222",
      stack: ["WORD2222", "PARA1111"],
    });
  });

  it("takes the smallest again at another point in the same stack", () => {
    expect(
      click(
        { x: 420, y: 170 },
        {
          targets: [PARAGRAPH, WORD, OTHER],
          previous: selectedAt("PARA1111", 220, 120),
        },
      ),
    ).toEqual({
      kind: "select",
      key: "WORD3333",
      stack: ["WORD3333", "PARA1111"],
    });
  });

  it("deselects on a click that reaches no mark, on a page and off one", () => {
    expect(click({ x: 320, y: 600 })).toEqual({ kind: "deselect" });
    expect(click({ x: 5, y: 5 })).toEqual({ kind: "deselect" });
  });

  it("leaves a drag to the browser, and keeps the selection it passes over", () => {
    expect(click({ x: 320, y: 170 }, { travel: 3.9 }).kind).toBe("select");
    expect(click({ x: 320, y: 170 }, { travel: 4 })).toEqual({
      kind: "ignore",
    });
  });

  it("leaves a gesture that left text selected alone", () => {
    expect(click({ x: 320, y: 170 }, { collapsed: false })).toEqual({
      kind: "ignore",
    });
  });

  it("gives a plain click to the PDF's own link, and Alt to the mark beneath", () => {
    expect(click({ x: 320, y: 170 }, { onLink: true })).toEqual({
      kind: "ignore",
    });
    expect(click({ x: 320, y: 170 }, { onLink: true, altKey: true })).toEqual({
      kind: "select",
      key: "WORD2222",
      stack: ["WORD2222", "PARA1111"],
    });
  });

  it("steps from nothing when the same point was last clicked on another page", () => {
    expect(
      click(
        { x: 320, y: 170 },
        {
          previous: {
            key: "WORD2222",
            pageIndex: 1,
            point: { x: 220, y: 120 },
          },
        },
      ),
    ).toEqual({
      kind: "select",
      key: "WORD2222",
      stack: ["WORD2222", "PARA1111"],
    });
  });
});
