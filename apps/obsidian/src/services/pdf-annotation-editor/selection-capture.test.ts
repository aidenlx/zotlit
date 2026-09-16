// @vitest-environment happy-dom
import { expect, it } from "vitest";

import { captureSelection, selectionPagesOf } from "./selection-capture";
import type { ClientBox, SelectionPage } from "./selection-capture";

/**
 * A US Letter page as PDF.js lays it out at 150 %: the matrix is the one
 * `PageViewport` builds for an unrotated page, so the inverse this module
 * applies is the exact inverse of `convertToViewportPoint`.
 *
 * @see https://github.com/mozilla/pdf.js/blob/v5.3.31/src/display/display_utils.js
 */
const SCALE = 1.5;
const PAGE_HEIGHT = 792;
const UNROTATED = [SCALE, 0, 0, -SCALE, 0, PAGE_HEIGHT * SCALE];

/** The same page turned a quarter turn clockwise, as `rotation: 90` builds it. */
const ROTATED_90 = [0, SCALE, SCALE, 0, 0, 0];

/** Where the page element sits on screen, which every client box is read against. */
function pageBox(top = 0): ClientBox {
  return {
    left: 20,
    top,
    right: 20 + 612 * SCALE,
    bottom: top + PAGE_HEIGHT * SCALE,
  };
}

/** The client box a PDF-point rectangle occupies on an unrotated page. */
function clientBoxOf(
  [x1, y1, x2, y2]: readonly [number, number, number, number],
  box: ClientBox,
): ClientBox {
  return {
    left: box.left + x1 * SCALE,
    top: box.top + (PAGE_HEIGHT - y2) * SCALE,
    right: box.left + x2 * SCALE,
    bottom: box.top + (PAGE_HEIGHT - y1) * SCALE,
  };
}

function page(overrides: Partial<SelectionPage> = {}): SelectionPage {
  const box = overrides.box ?? pageBox();
  return {
    pageIndex: 0,
    box,
    transform: UNROTATED,
    rects: [clientBoxOf([58.054, 601.98, 211.489, 610.112], box)],
    text: " Scientific visualization ",
    ...overrides,
  };
}

/** Rounded only for the comparison; the capture itself keeps every digit. */
function rounded(rects: readonly (readonly number[])[]): number[][] {
  return rects.map((rect) =>
    rect.map((value) => Math.round(value * 1e3) / 1e3),
  );
}

it("carries one page's boxes back to the PDF points they came from", () => {
  // The oracle is the Fixture's own underline on `rougier-2014.pdf`, converted
  // to client boxes and back.
  // @see packages/scripts/lib/fixture/spec.ts — `ANNOTATIONS`
  const box = pageBox();
  const stored = [
    [67.011, 612.638, 211.485, 620.77],
    [58.054, 601.98, 211.489, 610.112],
  ] as const;

  const captured = captureSelection([
    {
      ...page({ box }),
      rects: stored.map((rect) => clientBoxOf(rect, box)),
    },
  ]);

  expect(captured).not.toBeNull();
  expect(rounded(captured!.rects)).toEqual(rounded(stored));
  expect(captured!.nextPageRects).toBeUndefined();
  expect(captured!.pageIndex).toBe(0);
});

it("trims the quoted text", () => {
  expect(captureSelection([page()])?.text).toBe("Scientific visualization");
});

it("puts the second page's boxes in nextPageRects and joins the text with one space", () => {
  const first = pageBox();
  const second = pageBox(2000);

  const captured = captureSelection([
    { ...page({ pageIndex: 1, box: second }), text: "on the next page. " },
    { ...page({ pageIndex: 0, box: first }), text: "A quote that runs " },
  ]);

  expect(captured?.pageIndex).toBe(0);
  expect(captured?.text).toBe("A quote that runs on the next page.");
  expect(captured?.nextPageRects).toHaveLength(1);
});

it("keeps at most two pages, as Zotero's own reader does", () => {
  const captured = captureSelection(
    [0, 1, 2].map((pageIndex) => page({ pageIndex, text: `p${pageIndex}` })),
  );

  expect(captured?.pageIndex).toBe(0);
  expect(captured?.text).toBe("p0 p1");
});

it("drops a second page that is not the next one", () => {
  const captured = captureSelection([
    page({ pageIndex: 0, text: "first" }),
    page({ pageIndex: 4, text: "elsewhere" }),
  ]);

  expect(captured?.text).toBe("first");
  expect(captured?.nextPageRects).toBeUndefined();
});

it("clips a box that overhangs the page to the page box", () => {
  const box = pageBox();
  const overhang: ClientBox = {
    left: box.left - 500,
    top: box.top - 500,
    right: box.left + 100 * SCALE,
    bottom: box.top + 100 * SCALE,
  };

  const captured = captureSelection([page({ box, rects: [overhang] })]);

  // The clip leaves the page's own upper-left corner: x from 0, y from the top.
  expect(rounded(captured!.rects)).toEqual([
    [0, PAGE_HEIGHT - 100, 100, PAGE_HEIGHT],
  ]);
});

it("drops a box that falls wholly outside the page", () => {
  const box = pageBox();
  const outside: ClientBox = {
    left: box.right + 10,
    top: box.top + 10,
    right: box.right + 40,
    bottom: box.top + 40,
  };

  expect(captureSelection([page({ box, rects: [outside] })])).toBeNull();
});

it("reads a rotated page through the same inverse", () => {
  const box: ClientBox = {
    left: 0,
    top: 0,
    right: PAGE_HEIGHT * SCALE,
    bottom: 612 * SCALE,
  };
  // On a page turned a quarter turn, a PDF point (x, y) lands at
  // (y * scale, x * scale), so this client box is the PDF box [10, 20, 30, 40].
  const rect: ClientBox = {
    left: 20 * SCALE,
    top: 10 * SCALE,
    right: 40 * SCALE,
    bottom: 30 * SCALE,
  };

  const captured = captureSelection([
    { ...page({ box }), transform: ROTATED_90, rects: [rect] },
  ]);

  expect(rounded(captured!.rects)).toEqual([[10, 20, 30, 40]]);
});

it("answers nothing for a selection that quotes only whitespace", () => {
  expect(captureSelection([page({ text: "   " })])).toBeNull();
});

it("answers nothing where no page carries a box", () => {
  expect(captureSelection([])).toBeNull();
});

it("splits one range into the part each page holds", () => {
  const first = document.createElement("div");
  const second = document.createElement("div");
  first.textContent = "A quote that runs";
  second.textContent = "on the next page.";
  document.body.append(first, second);

  const range = document.createRange();
  range.setStart(first.firstChild!, 2);
  range.setEnd(second.firstChild!, 11);

  const pages = selectionPagesOf(range, [
    {
      pageIndex: 0,
      view: { div: first, viewport: { transform: UNROTATED } } as never,
    },
    {
      pageIndex: 1,
      view: { div: second, viewport: { transform: UNROTATED } } as never,
    },
  ]);

  expect(pages.map(({ pageIndex, text }) => [pageIndex, text])).toEqual([
    [0, "quote that runs"],
    [1, "on the next"],
  ]);
});

it("leaves out a page the range never reaches", () => {
  const inside = document.createElement("div");
  const outside = document.createElement("div");
  inside.textContent = "quoted";
  outside.textContent = "untouched";
  document.body.append(inside, outside);

  const range = document.createRange();
  range.selectNodeContents(inside);

  const pages = selectionPagesOf(range, [
    {
      pageIndex: 0,
      view: { div: inside, viewport: { transform: UNROTATED } } as never,
    },
    {
      pageIndex: 1,
      view: { div: outside, viewport: { transform: UNROTATED } } as never,
    },
  ]);

  expect(pages.map(({ pageIndex }) => pageIndex)).toEqual([0]);
});
