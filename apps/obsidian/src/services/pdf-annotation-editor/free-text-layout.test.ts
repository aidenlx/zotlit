import { expect, it } from "vitest";

import { parseAnnotationPosition } from "@zotlit/db";
import type { PdfTextPosition } from "@zotlit/db";

import { viewport } from "./__fixtures__";
import { freeTextLayout } from "./free-text-layout";

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

/** PDF points carry three decimals; the rest is the float noise of the sum. */
function round<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, item: unknown) =>
      typeof item === "number" ? Math.round(item * 1000) / 1000 : item,
    ),
  ) as T;
}
