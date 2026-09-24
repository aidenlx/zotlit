import { describe, expect, it } from "vitest";

import { parseAnnotationPosition } from "@zotlit/db";
import type { PdfTextPosition } from "@zotlit/db";

import { viewport } from "./__fixtures__";
import {
  fitFreeTextBox,
  freeTextLayout,
  freeTextLines,
} from "./free-text-layout";
import type { TextMeasure } from "./free-text-layout";

/** The Fixture's own free-text Annotation, HRK7BG32, in PDF points. */
const RECT = [398.804, 685.107, 560.804, 702.107] as const;
const FONT_SIZE = 14;
const PADDING = 1.5;

/**
 * Every expectation below is worked out by hand from two published rules, so
 * nothing here re-derives the module's own answer.
 *
 * PDF.js maps a PDF point into page units per rotation: `(x, 792 - y)` at 0,
 * `(y, x)` at 90, `(612 - x, y)` at 180 and `(792 - y, 612 - x)` at 270, on the
 * 612 × 792 box the Fixture's viewport carries. Zotero lays the run out inside
 * the rectangle it stored and turns rectangle and run together about that
 * rectangle's own centre, so the stored turn reads negative here — PDF measures
 * its y upwards and a page measures it downwards.
 *
 * @see https://github.com/mozilla/pdf.js/blob/v5.3.31/src/display/display_utils.js
 *   `PageViewport`
 * @see https://github.com/zotero/reader/blob/master/src/pdf/page.js
 *   `_pushSelectedOutlines`
 */
const CASES = [
  {
    name: "a straight page takes no turn at all",
    page: 0,
    stored: 0,
    baseline: [398.804, 103.893],
    turns: [],
    ring: { rect: [397.304, 88.393, 562.304, 108.393], turns: [] },
    hit: [398.804, 89.893, 560.804, 106.893],
  },
  {
    name: "a quarter-turned page reads down its own long edge",
    page: 90,
    stored: 0,
    baseline: [688.107, 398.804],
    turns: [{ angle: 90, pivot: [688.107, 398.804] }],
    ring: { rect: [683.607, 397.304, 703.607, 562.304], turns: [] },
    hit: [685.107, 398.804, 702.107, 560.804],
  },
  {
    name: "an upside-down page reads back the way it came",
    page: 180,
    stored: 0,
    baseline: [213.196, 688.107],
    turns: [{ angle: 180, pivot: [213.196, 688.107] }],
    ring: { rect: [49.696, 683.607, 214.696, 703.607], turns: [] },
    hit: [51.196, 685.107, 213.196, 702.107],
  },
  {
    name: "a three-quarter-turned page reads up its own long edge",
    page: 270,
    stored: 0,
    baseline: [103.893, 213.196],
    turns: [{ angle: -90, pivot: [103.893, 213.196] }],
    ring: { rect: [88.393, 49.696, 108.393, 214.696], turns: [] },
    hit: [89.893, 51.196, 106.893, 213.196],
  },
  {
    name: "an Annotation turned on a straight page turns about its own centre",
    page: 0,
    stored: 90,
    baseline: [398.804, 103.893],
    turns: [{ angle: -90, pivot: [479.804, 98.393] }],
    ring: {
      rect: [397.304, 88.393, 562.304, 108.393],
      turns: [{ angle: -90, pivot: [479.804, 98.393] }],
    },
    // The stored turn sweeps the 162 × 17 rectangle into a 17 × 162 one.
    hit: [471.304, 17.393, 488.304, 179.393],
  },
  {
    name: "both turns compose, the page's own applied first",
    page: 90,
    stored: 90,
    baseline: [688.107, 398.804],
    turns: [
      { angle: -90, pivot: [693.607, 479.804] },
      { angle: 90, pivot: [688.107, 398.804] },
    ],
    ring: {
      rect: [683.607, 397.304, 703.607, 562.304],
      turns: [{ angle: -90, pivot: [693.607, 479.804] }],
    },
    hit: [612.607, 471.304, 774.607, 488.304],
  },
] as const;

function position(rotation: number): PdfTextPosition {
  return parseAnnotationPosition(
    {
      pageIndex: 0,
      fontSize: FONT_SIZE,
      rotation,
      rects: [[...RECT]],
    },
    "application/pdf",
  ) as PdfTextPosition;
}

for (const testCase of CASES) {
  it(testCase.name, () => {
    const page = viewport({ rotation: testCase.page });

    const layout = freeTextLayout(
      (x, y) => page.convertToViewportPoint(x, y),
      position(testCase.stored),
      PADDING,
    );

    expect(round(layout)).toEqual({
      baseline: testCase.baseline,
      turns: testCase.turns,
      ring: testCase.ring,
      hit: testCase.hit,
    });
  });
}

it("reaches the whole run it draws, wherever the two are turned", () => {
  // The run is as long as the rectangle Zotero sized to it, so a hit box that
  // holds the turned rectangle holds every glyph inside it.
  for (const { page, stored } of CASES) {
    const turned = viewport({ rotation: page });
    const layout = freeTextLayout(
      (x, y) => turned.convertToViewportPoint(x, y),
      position(stored),
      PADDING,
    );
    const [left, top, right, bottom] = layout.hit;
    const width = RECT[2] - RECT[0];
    const height = RECT[3] - RECT[1];
    const longer = Math.max(width, height);

    expect({
      page,
      stored,
      holdsTheRun:
        right - left >= Math.min(width, height) - 0.01 &&
        bottom - top >= Math.min(width, height) - 0.01 &&
        Math.max(right - left, bottom - top) >= longer - 0.01,
    }).toEqual({ page, stored, holdsTheRun: true });
  }
});

/**
 * A fixed-width font: every character, the space included, is half the font
 * size wide, so at 10 points each one is 5 points and every expectation below
 * is a count of characters.
 */
const MONO: TextMeasure = (text, fontSize) => text.length * fontSize * 0.5;

describe("breaking free text into lines as Zotero's canvas render does, but not counting a line's trailing space", () => {
  const at = (text: string, width: number) =>
    freeTextLines(text, width, { fontSize: 10, measure: MONO });

  it("keeps one empty line for empty text", () => {
    expect(at("", 100)).toEqual([""]);
  });

  it("breaks a word too long for the line inside the word", () => {
    // 22 points hold four 5-point characters; the fifth reaches 25.
    expect(at("abcdefghij", 22)).toEqual(["abcd", "efgh", "ij"]);
  });

  it("starts a line at every newline, an empty one included", () => {
    expect(at("ab cd\nef", 100)).toEqual(["ab cd", "ef"]);
    expect(at("a\n\nb", 100)).toEqual(["a", "", "b"]);
  });

  it("wraps between words, not counting the space a line ends on", () => {
    // "aa bb" is 25 points and fits 27; "aa bb cc" is 40. A line ending on
    // "aa bb " would reach 30, which Zotero's textarea never counts.
    expect(at("aa bb cc", 27)).toEqual(["aa bb", "cc"]);
    expect(at("aa bb", 25)).toEqual(["aa bb"]);
  });
});

describe("fitting a free-text box, as Zotero's reader fits it", () => {
  /** A US Letter page, in PDF points. */
  const PAGE_BOX = [0, 0, 612, 792] as const;

  /**
   * At 10 points one line is 12 points high, and a box is laid out at its own
   * width once it is 20 points high. A box starting 10 points square at
   * (100, 700) has its top-left corner at (100, 710).
   */
  const fit = (
    text: string,
    rect: [number, number, number, number] = [100, 700, 110, 710],
    rotation = 0,
  ) =>
    round(
      fitFreeTextBox(
        text,
        { rects: [rect], rotation, fontSize: 10 },
        { measure: MONO, pageBox: PAGE_BOX },
      ),
    );

  it("fits empty text one letter and the padding wide, one line high", () => {
    // Zotero measures an empty text as "A": 5 points, plus 5 of padding.
    expect(fit("")).toEqual([100, 698, 110, 710]);
  });

  it("fits one line to its own width plus 5 points, keeping the top-left corner", () => {
    // "hello" is 25 points; the box is one 12-point line high, hanging down
    // from the corner it started at.
    expect(fit("hello")).toEqual([100, 698, 130, 710]);
  });

  it("caps a long line at 300 points and wraps it", () => {
    // Thirteen 9-letter words, 645 points on one line. At 300 points a line
    // holds six words (59 characters, 295 points), so 6 + 6 + 1: three lines.
    const text = Array.from({ length: 13 }, () => "abcdefghi").join(" ");
    expect(fit(text)).toEqual([100, 674, 400, 710]);
  });

  it("keeps the width of a box two font sizes high and lays the text out in it", () => {
    // 30 points high, so its 50-point width holds: "aaaa bbbb" is 45 points,
    // "cccc" goes to a second line, and the box becomes two lines, 24 high.
    expect(fit("aaaa bbbb cccc", [100, 680, 150, 710])).toEqual([
      100, 686, 150, 710,
    ]);
  });

  it("fits text its newlines make two lines tall to its widest line, with no padding", () => {
    // "aa" is 10 points and "bbbb" 20. At 20 points the two lines are 24
    // points high, two font sizes or more, so Zotero's height rule adds no 5
    // points: the box is 20 wide and 24 high, hanging from (100, 710).
    expect(fit("aa\nbbbb")).toEqual([100, 686, 120, 710]);
  });

  it("widens a box sized to its text by what it reaches past the page's left inset", () => {
    // "hello" fits [2, 698, 32, 710], 3 short of the inset at 5. Zotero adds
    // that 3 to the width rather than moving the box: 33 wide from x 2.
    expect(fit("hello", [2, 700, 12, 710])).toEqual([2, 698, 35, 710]);
  });

  it("leaves a box sized to its text where it is when it reaches past the page's bottom inset", () => {
    // "hello" fits [100, 0, 130, 12], 5 below the inset at 5. Zotero drops
    // the vertical move on this path and sizes the box from the same corner.
    expect(fit("hello", [100, 2, 110, 12])).toEqual([100, 0, 130, 12]);
  });

  it("keeps the top-left corner of a turned box where it was on the page", () => {
    // Turned a quarter counter-clockwise about its centre (105, 705), the old
    // box's top-left corner lands at (100, 700). The new 30 × 12 box, turned
    // about its own centre (106, 715), puts its top-left corner (91, 721)
    // there too: (-15, 6) from the centre turns to (-6, -15).
    expect(fit("hello", [100, 700, 110, 710], 90)).toEqual([91, 709, 121, 721]);
  });

  it("moves a box of fixed width back 5 points inside the page", () => {
    // [590, 718, 640, 730] reaches 640, past 612 - 5: it moves 33 left.
    expect(fit("aa", [590, 700, 640, 730])).toEqual([557, 718, 607, 730]);
    // [100, 788, 150, 800] reaches 800, past 792 - 5: it moves 13 down.
    expect(fit("aa", [100, 770, 150, 800])).toEqual([100, 775, 150, 787]);
  });

  it("narrows a box sized to its text by what it reaches past the page's right inset", () => {
    // "hello" fits [580, 698, 610, 710], 3 past 607; Zotero narrows the box
    // rather than moving it, and "hello" still fits 27 points on one line.
    expect(fit("hello", [580, 700, 590, 710])).toEqual([580, 698, 607, 710]);
  });
});

/** PDF points carry three decimals; the rest is the float noise of the sum. */
function round<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, item: unknown) =>
      typeof item === "number" ? Math.round(item * 1000) / 1000 : item,
    ),
  ) as T;
}
