import { describe, expect, it } from "vitest";

import type { Rect, StructuredChar, StructuredPage } from "@/chars";
import { computeSortIndex, sortIndexRect } from "@/sort-index";

/** Letter-sized page, origin at zero, so `top` is 792 minus the rect's `y2`. */
const page = (chars: readonly Partial<StructuredChar>[]): StructuredPage => ({
  pageIndex: 0,
  viewBox: [0, 0, 612, 792],
  chars: chars.map((char, offset) => ({ offset, ...char }) as StructuredChar),
});

const at = (rect: Rect) => ({ rect });

describe("the Sort Index", () => {
  it("names the page, the nearest glyph, and the distance from the top", () => {
    const sortIndex = computeSortIndex(
      page([
        at([60, 700, 70, 712]),
        at([60, 600, 70, 612]),
        at([60, 500, 70, 512]),
      ]),
      { pageIndex: 0, rects: [[58, 598, 300, 614]] },
    );

    expect(sortIndex).toBe("00000|000001|00178");
  });

  it("measures a highlight from the rectangle with the largest x2", () => {
    // Zotero's comment says y2; its code sorts on index 2, which is x2.
    expect(
      sortIndexRect({
        pageIndex: 0,
        rects: [
          [60, 700, 200, 712],
          [60, 600, 400, 612],
        ],
      }),
    ).toEqual([60, 600, 400, 612]);
  });

  it("keeps the earlier rectangle when two share the largest x2", () => {
    expect(
      sortIndexRect({
        pageIndex: 0,
        rects: [
          [60, 700, 200, 712],
          [10, 600, 200, 612],
        ],
      }),
    ).toEqual([60, 700, 200, 712]);
  });

  it("measures ink from the bounding box of every path point", () => {
    expect(
      sortIndexRect({
        pageIndex: 0,
        paths: [
          [100, 200, 120, 260],
          [80, 240, 140, 210],
        ],
      }),
    ).toEqual([80, 200, 140, 260]);
  });

  it("gives a page with no characters offset zero and the geometric top", () => {
    expect(
      computeSortIndex(page([]), {
        pageIndex: 0,
        rects: [[58, 598, 300, 614]],
      }),
    ).toBe("00000|000000|00178");
  });

  it("clamps a rectangle above the page box to top zero", () => {
    expect(
      computeSortIndex(page([at([60, 700, 70, 712])]), {
        pageIndex: 0,
        rects: [[58, 790, 300, 900]],
      }),
    ).toBe("00000|000000|00000");
  });

  it("keeps the first digits of a value too wide for its field", () => {
    expect(
      computeSortIndex(page([at([60, 700, 70, 712])]), {
        pageIndex: 1_234_567,
        rects: [[58, 790, 300, 800]],
      }),
    ).toBe("12345|000000|00000");
  });

  it("pads every field to the width Zotero's backend validates", () => {
    const sortIndex = computeSortIndex(page([at([60, 700, 70, 712])]), {
      pageIndex: 12,
      rects: [[58, 100, 300, 120]],
    });

    expect(sortIndex).toBe("00012|000000|00672");
    expect(sortIndex).toHaveLength(18);
  });
});
