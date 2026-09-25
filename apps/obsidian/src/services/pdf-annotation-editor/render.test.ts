// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import { parseAnnotationPosition } from "@zotlit/db";

import { themeHook } from "@/lib/theme-hooks";
import type { AnnotationRecord } from "@/services/annotation-repository/service";

import { annotation, viewport } from "./__fixtures__";
import { HANDLE_RADIUS } from "./geometry-edit";
import { markAnchor, marksAtPoint, pagePointOf } from "./hit-test";
import type { PageBox } from "./hit-test";
import {
  groupAnnotationsByPage,
  markTargets,
  patchSelectedMark,
  renderAnnotationOverlay,
  unitPointOf,
  unitsPerPixel,
  withPosition,
} from "./render";
import type { MeasuredFont, OverlayPageView } from "./render";

/** The same page, described from a non-zero origin, as a PDF may do. */
const OFFSET_BOX = [10, 20, 622, 812] as const;

/** The colour the Fixture gives each of its Annotations on `rougier-2014.pdf`. */
const FIXTURE_COLORS: Record<string, string> = {
  PUPR5FG5: "#2ea8e5",
  K3JRFLFQ: "#ff6666",
  C94NJNYG: "#ffd400",
  FDRFQ7C2: "#ffd400",
  TYY6Z6ZF: "#5fb236",
  HRK7BG32: "#a28ae5",
};

/**
 * A fixed-width font: every character is 0.4 font sizes wide, 5.6 points at
 * 14, so the Fixture's 25-character comment is 140 points and fits its
 * 162-point box on one line.
 */
const MONO: MeasuredFont = {
  family: "monospace",
  measure: (text, fontSize) => text.length * fontSize * 0.4,
};

/** One rectangle near the top of the page, in PDF points. */
const RECT = [100, 700, 200, 720] as const;

/**
 * Where `RECT` lands in page units, worked out by hand from PDF.js's
 * `PageViewport` matrix expanded per rotation, as `[x, y, width, height]`
 * beside the overlay `viewBox` the same rotation gives.
 *
 * At rotation 0 `vx = x - vb[0]` and `vy = vb[3] - y`, so the rectangle's
 * corners `(100, 700)` and `(200, 720)` land at `(100, 92)` and `(200, 72)`,
 * which re-normalise to a box 100 wide and 20 high with its top at 72.
 *
 * @see https://github.com/mozilla/pdf.js/blob/v5.3.31/src/display/display_utils.js
 *   `PageViewport` — the nearest tagged release below the 5.3.34 build Obsidian
 *   bundles, whose constructor is unchanged between the two.
 */
const ROTATIONS = [
  { rotation: 0, box: "612 792", mark: ["100", "72", "100", "20"] },
  { rotation: 90, box: "792 612", mark: ["700", "100", "20", "100"] },
  { rotation: 180, box: "612 792", mark: ["412", "700", "100", "20"] },
  { rotation: 270, box: "792 612", mark: ["72", "412", "20", "100"] },
] as const;

it("draws all six Zotero annotation types with the primitive each one calls for", () => {
  const page = pageView();

  renderAnnotationOverlay(page, {
    font: MONO,
    annotations: pageAnnotations([
      record("PUPR5FG5", "highlight", {
        pageIndex: 0,
        rects: [[265.833, 611.202, 374.503, 620.019]],
      }),
      record("K3JRFLFQ", "underline", {
        pageIndex: 0,
        rects: [[67.011, 612.638, 211.485, 620.77]],
      }),
      record("C94NJNYG", "note", {
        pageIndex: 0,
        rects: [[566.901, 598.393, 588.901, 620.393]],
      }),
      record("FDRFQ7C2", "image", {
        pageIndex: 0,
        rects: [[48.75, 395.509, 570, 743.723]],
      }),
      record("TYY6Z6ZF", "ink", {
        pageIndex: 0,
        width: 2,
        paths: [[66.964, 674.348, 66.629, 673.26]],
      }),
      record("HRK7BG32", "text", {
        pageIndex: 0,
        fontSize: 14,
        rotation: 0,
        rects: [[398.804, 685.107, 560.804, 702.107]],
      }),
    ]),
  });

  expect(marksIn(page)).toEqual({
    PUPR5FG5: ["rect", "highlight"],
    K3JRFLFQ: ["line", "underline"],
    C94NJNYG: ["g", "note"],
    FDRFQ7C2: ["rect", "image"],
    TYY6Z6ZF: ["path", "ink"],
    HRK7BG32: ["text", "text"],
  });

  // The underline sits on the bottom edge of its rectangle: 792 - 612.638.
  expect(pointsOf(page, "K3JRFLFQ", ["x1", "y1", "x2", "y2"])).toEqual([
    67.011, 179.362, 211.485, 179.362,
  ]);
  expect(attributesOf(page, "K3JRFLFQ")).toMatchObject({
    stroke: "#ff6666",
    "stroke-width": "1",
  });
  // The ink stroke keeps the width Zotero stored, in the page's own points,
  // and is stroked five percent darker than stored, as Zotero's reader does:
  // #5fb236 is (95, 178, 54), which scales to (90.25, 169.1, 51.3).
  expect(pathOf(page, "TYY6Z6ZF")).toEqual([
    [66.964, 117.652],
    [66.629, 118.74],
  ]);
  expect(attributesOf(page, "TYY6Z6ZF")).toMatchObject({
    fill: "none",
    stroke: "#5aa933",
    "stroke-width": "2",
  });
  // The image is stroked, never filled, so the excerpt underneath stays legible.
  expect(attributesOf(page, "FDRFQ7C2")).toMatchObject({
    fill: "none",
    stroke: "#ffd400",
    "stroke-width": "3",
  });
  // The note draws a glyph in lucide's idiom: a filled, stroked body with its
  // bottom-right corner cut, and that fold's crease as an unfilled stroke,
  // both mapped onto the stored rect by the group's own transform.
  const note = markIn(page, "C94NJNYG");
  expect(note.childNodes).toHaveLength(2);
  // The rect is 22 x 22 page units, mapped from lucide's 24-unit grid; the
  // top carries the same float noise `round()` elsewhere in this file exists
  // to absorb.
  expect(note.getAttribute("transform")).toBe(
    `translate(566.901 171.60699999999997) scale(${22 / 24} ${22 / 24})`,
  );
  expect(note.getAttribute("stroke")).toBe("#ffd400");
  expect([...note.classList].toSorted()).toEqual([
    "zt-pdf-annotation-mark",
    "zt-pdf-annotation-note-icon",
  ]);
  expect([...note.firstElementChild!.classList]).toEqual([
    "zt-pdf-annotation-note-fill",
  ]);
  expect(note.firstElementChild!.getAttribute("fill")).toBe("#ffd400");
  // The fold's stroke inherits from the group, not an attribute of its own:
  // an SVG presentation attribute never substitutes `var()`, so a `stroke`
  // attribute set through the stylesheet's accent variable would render
  // black in either theme.
  expect([...note.lastElementChild!.classList]).toEqual([
    "zt-pdf-annotation-note-crease",
  ]);
  expect(note.lastElementChild!.getAttribute("fill")).toBeNull();
  expect(note.lastElementChild!.getAttribute("stroke")).toBeNull();
  // The free text is the comment on one line, at the size Zotero stored,
  // filled five percent darker than stored as Zotero's reader draws it:
  // #a28ae5 is (162, 138, 229), which scales to (153.9, 131.1, 217.55).
  expect(linesOf(page, "HRK7BG32")).toEqual([
    ["Making figures is hard :(", 398.804, 103.893],
  ]);
  expect(attributesOf(page, "HRK7BG32")).toMatchObject({
    "font-size": "14",
    fill: "#9a83da",
  });
});

describe("free text", () => {
  /** A text Annotation in the Fixture's box, its top edge at y 702.107. */
  const text = (comment: string, rect: readonly number[]) => ({
    ...record("HRK7BG32", "text", {
      pageIndex: 0,
      fontSize: 14,
      rotation: 0,
      rects: [rect],
    }),
    comment,
  });

  it("starts a line at each newline, each 1.2 font sizes below the last", () => {
    const page = pageView();

    renderAnnotationOverlay(page, {
      font: MONO,
      annotations: pageAnnotations([
        text("Two\nlines", [398.804, 668.507, 560.804, 702.107]),
      ]),
    });

    // The first baseline hangs one font size below the top edge,
    // 792 - 702.107 + 14; the next one 16.8 below that.
    expect(linesOf(page, "HRK7BG32")).toEqual([
      ["Two", 398.804, 103.893],
      ["lines", 398.804, 120.693],
    ]);
  });

  it("stacks the lines across the reading direction on a page turned a quarter", () => {
    const page = pageView(viewport({ rotation: 90 }));

    renderAnnotationOverlay(page, {
      font: MONO,
      annotations: pageAnnotations([
        text("Two\nlines", [398.804, 668.507, 560.804, 702.107]),
      ]),
    });

    // A quarter turn maps PDF (x, y) to page (y, x), so the baseline start,
    // PDF (398.804, 702.107 - 14), lands at (688.107, 398.804), and one point
    // along the run moves y by one: the run reads down, turned 90 degrees
    // about that start. The lines are laid out unturned, 16.8 apart, and the
    // turn carries the second one to the left of the first.
    expect(attributesOf(page, "HRK7BG32").transform).toBe(
      "rotate(90 688.107 398.804)",
    );
    expect(linesOf(page, "HRK7BG32")).toEqual([
      ["Two", 688.107, 398.804],
      ["lines", 688.107, 415.604],
    ]);
  });

  it("wraps the text at the width of its box", () => {
    const page = pageView();

    renderAnnotationOverlay(page, {
      font: MONO,
      annotations: pageAnnotations([
        text("Making figures is hard :(", [398.804, 651.707, 468.804, 702.107]),
      ]),
    });

    // 70 points hold 12 characters: "Making figures" is 14, "figures is" 10,
    // "figures is hard" 15.
    expect(linesOf(page, "HRK7BG32").map(([line]) => line)).toEqual([
      "Making",
      "figures is",
      "hard :(",
    ]);
  });

  it("patches its lines as a resize moves and narrows its box", () => {
    const page = pageView();
    renderAnnotationOverlay(page, {
      font: MONO,
      annotations: pageAnnotations([
        text("Making figures is hard :(", [398.804, 668.507, 560.804, 702.107]),
      ]),
      selected: new Set(["HRK7BG32"]),
      handles: true,
    });
    const mark = markIn(page, "HRK7BG32");

    const patched = patchSelectedMark(
      page,
      pageAnnotations([
        text("Making figures is hard :(", [490.804, 651.707, 560.804, 702.107]),
      ])[0]!,
      { handles: true, font: MONO },
    );

    expect(patched).toBe(true);
    expect(markIn(page, "HRK7BG32")).toBe(mark);
    // The left side moved to 490.804, and 70 points wrap the text in three.
    expect(linesOf(page, "HRK7BG32")).toEqual([
      ["Making", 490.804, 103.893],
      ["figures is", 490.804, 120.693],
      ["hard :(", 490.804, 137.493],
    ]);
    // What a full render of the new box draws, node for node.
    const redrawn = pageView();
    renderAnnotationOverlay(redrawn, {
      font: MONO,
      annotations: pageAnnotations([
        text("Making figures is hard :(", [490.804, 651.707, 560.804, 702.107]),
      ]),
      selected: new Set(["HRK7BG32"]),
      handles: true,
    });
    expect(overlayIn(page).outerHTML).toBe(overlayIn(redrawn).outerHTML);
  });
});

it.each(ROTATIONS)(
  "places a mark where PDF.js's own transform puts it at rotation $rotation",
  ({ rotation, box, mark }) => {
    const page = pageView(viewport({ rotation }));

    renderAnnotationOverlay(page, {
      font: MONO,
      annotations: pageAnnotations([highlight()]),
    });

    expect(overlayIn(page).getAttribute("viewBox")).toBe(`0 0 ${box}`);
    expect(overlayIn(page).getAttribute("preserveAspectRatio")).toBe("none");
    expect(rectOf(page, "PUPR5FG5")).toEqual(mark);
  },
);

it("carries the page's own `/UserUnit` into the page-unit box", () => {
  // Half-size user units halve every page coordinate: the 612 x 792 box becomes
  // 306 x 396 and the rectangle's top edge, 72 at rotation 0, becomes 36.
  const page = pageView(viewport({ userUnit: 0.5 }));

  renderAnnotationOverlay(page, {
    font: MONO,
    annotations: pageAnnotations([highlight()]),
  });

  expect(overlayIn(page).getAttribute("viewBox")).toBe("0 0 306 396");
  expect(rectOf(page, "PUPR5FG5")).toEqual(["50", "36", "50", "10"]);
});

it("measures from the page box's own origin rather than from zero", () => {
  // A box starting at (10, 20) shifts the same rectangle left by 10, and its
  // top edge is measured from 812 rather than 792.
  const page = pageView(viewport({ box: OFFSET_BOX }));

  renderAnnotationOverlay(page, {
    font: MONO,
    annotations: pageAnnotations([highlight()]),
  });

  expect(overlayIn(page).getAttribute("viewBox")).toBe("0 0 612 792");
  expect(rectOf(page, "PUPR5FG5")).toEqual(["90", "92", "100", "20"]);
});

it("builds the same overlay at every zoom step", () => {
  const markup = (scale: number) => {
    const page = pageView(viewport({ scale }));
    renderAnnotationOverlay(page, {
      font: MONO,
      annotations: pageAnnotations([highlight()]),
    });
    return overlayIn(page).outerHTML;
  };

  const reference = markup(1);

  expect(reference).toContain('viewBox="0 0 612 792"');
  for (const scale of [0.25, 0.5, 1.1, 2.5, 10]) {
    expect(markup(scale), `scale ${scale}`).toBe(reference);
  }
});

it("divides the built viewport out when the seam offers no rebuild", () => {
  // A viewport with no `clone` is the documented fallback: the same page units,
  // reached by dividing out `scale * userUnit`.
  const built = viewport({ scale: 2 });
  const page = pageView({ ...built, clone: undefined });

  renderAnnotationOverlay(page, {
    font: MONO,
    annotations: pageAnnotations([highlight()]),
  });

  expect(overlayIn(page).getAttribute("viewBox")).toBe("0 0 612 792");
  expect(rectOf(page, "PUPR5FG5")).toEqual(["100", "72", "100", "20"]);
});

it("draws a spilled-over mark on the next page from that page's own rectangles", () => {
  const spilled = record("PUPR5FG5", "highlight", {
    pageIndex: 0,
    rects: [RECT],
    nextPageRects: [[100, 80, 200, 100]],
  });
  const first = pageView();
  const second = pageView();
  const annotations = groupAnnotationsByPage([spilled]);

  renderAnnotationOverlay(first, {
    font: MONO,
    annotations: annotations.get(0) ?? [],
  });
  renderAnnotationOverlay(second, {
    font: MONO,
    annotations: annotations.get(1) ?? [],
  });

  expect(rectOf(first, "PUPR5FG5")).toEqual(["100", "72", "100", "20"]);
  // 792 - 100 = 692 down the second page, where the quote continues.
  expect(rectOf(second, "PUPR5FG5")).toEqual(["100", "692", "100", "20"]);
});

it("paints marks that take no pointer input, last in the page", () => {
  const page = pageView();
  const textLayer = page.div.ownerDocument.createElement("div");
  page.div.append(textLayer);

  renderAnnotationOverlay(page, {
    font: MONO,
    annotations: pageAnnotations([highlight()]),
    selected: new Set(["PUPR5FG5"]),
  });

  const overlay = overlayIn(page);

  expect(page.div.lastElementChild).toBe(overlay);
  expect(overlay.getAttribute("aria-hidden")).toBe("true");
  // The public hooks a theme styles the overlay and its marks through.
  expect(overlay.classList.contains("zt-pdf-annotation-overlay")).toBe(true);
  expect([...markIn(page, "PUPR5FG5").classList].toSorted()).toEqual([
    "is-selected",
    "zt-pdf-annotation-highlight",
    "zt-pdf-annotation-mark",
  ]);
  // The selected mark's outline is appended last, above the mark itself, and
  // hugs its own rect padded by the mark's own hairline gap rather than a
  // presentation `stroke` — that comes from the stylesheet's accent colour.
  expect(overlay.childElementCount).toBe(2);
  const outline = overlay.lastElementChild!;
  expect(outline.tagName).toBe("path");
  expect([...outline.classList]).toEqual([
    "zt-pdf-annotation-selection-outline",
  ]);
  expect(outline.getAttribute("d")).toBe(
    "M 98.5 70.5 L 201.5 70.5 L 201.5 93.5 L 98.5 93.5 Z",
  );
  expect(outline.getAttribute("fill")).toBe("none");
  expect(outline.getAttribute("stroke-linejoin")).toBe("round");
  expect(outline.getAttribute("vector-effect")).toBe("non-scaling-stroke");
  expect(outline.getAttribute("stroke")).toBeNull();
});

it("casts a selected ink stroke's own path under it, wider, rather than framing it in a box", () => {
  const page = pageView();

  renderAnnotationOverlay(page, {
    font: MONO,
    annotations: pageAnnotations([
      record("TYY6Z6ZF", "ink", {
        pageIndex: 0,
        width: 2,
        // An L-shaped stroke: the box round it swallows the empty corner it
        // turns, so a box outline would trace that corner and this does not.
        paths: [[60, 700, 60, 660, 100, 660]],
      }),
    ]),
    selected: new Set(["TYY6Z6ZF"]),
  });

  const overlay = overlayIn(page);
  const casing = overlay.querySelector<SVGPathElement>(
    `.${themeHook.pdfAnnotationSelectionOutline}`,
  )!;
  const stroke = markIn(page, "TYY6Z6ZF");

  // The casing draws exactly what the pen draws, so it follows every turn the
  // stroke takes and reaches nowhere the stroke does not.
  expect(casing.getAttribute("d")).toBe(stroke.getAttribute("d"));
  // Wider by the padding either side, and painted first so the pen covers its
  // middle and leaves the accent showing as a band.
  expect(casing.style.strokeWidth).toBe("5");
  expect(stroke.getAttribute("stroke-width")).toBe("2");
  expect(overlay.firstElementChild).toBe(casing);
  expect(casing.compareDocumentPosition(stroke)).toBe(
    Node.DOCUMENT_POSITION_FOLLOWING,
  );
});

it("draws a single-point ink stroke as a round dot, in the page's colour when none is stored", () => {
  const page = pageView();

  renderAnnotationOverlay(page, {
    font: MONO,
    annotations: pageAnnotations([
      record("DOT23456", "ink", {
        pageIndex: 0,
        width: 4,
        paths: [[100, 700]],
      }),
    ]),
  });

  // A move-to alone draws nothing; the line-to to the same point is what the
  // round cap turns into a dot.
  expect(attributesOf(page, "DOT23456")).toMatchObject({
    d: "M 100 92 L 100 92",
    stroke: "currentColor",
    "stroke-linecap": "round",
    "stroke-width": "4",
  });
});

it("draws no outline for a mark the caller left unselected", () => {
  const page = pageView();

  renderAnnotationOverlay(page, {
    font: MONO,
    annotations: pageAnnotations([highlight()]),
  });

  expect(
    overlayIn(page).querySelector(".zt-pdf-annotation-selection-outline"),
  ).toBeNull();
});

it("leaves the page as it found it when the annotations are gone", () => {
  const page = pageView();
  renderAnnotationOverlay(page, {
    font: MONO,
    annotations: pageAnnotations([highlight()]),
  });

  renderAnnotationOverlay(page, { font: MONO, annotations: [] });

  expect(page.div.childElementCount).toBe(0);
});

it("draws nothing for a type whose stored position is not the shape it pairs with", () => {
  const page = pageView();

  renderAnnotationOverlay(page, {
    font: MONO,
    // An ink position under a highlight: a pairing Zotero never writes.
    annotations: pageAnnotations([
      record("PUPR5FG5", "highlight", {
        pageIndex: 0,
        width: 2,
        paths: [[10, 20, 30, 40]],
      }),
    ]),
  });

  expect(page.div.childElementCount).toBe(0);
});

it("keys the annotations by the page that draws them, parsing nothing per page", () => {
  const grouped = groupAnnotationsByPage([
    record("PUPR5FG5", "highlight", {
      pageIndex: 0,
      rects: [RECT],
    }),
    record("TYY6Z6ZF", "ink", {
      pageIndex: 2,
      width: 2,
      paths: [[10, 20, 30, 40]],
    }),
    record("HRK7BG32", "text", {
      pageIndex: 2,
      fontSize: 14,
      rotation: 0,
      rects: [[10, 40, 100, 55]],
    }),
  ]);

  expect([...grouped.keys()].toSorted((a, b) => a - b)).toEqual([0, 2]);
  expect(grouped.get(2)?.map(({ annotation }) => annotation.key)).toEqual([
    "TYY6Z6ZF",
    "HRK7BG32",
  ]);
  expect(grouped.get(0)?.[0]?.position.kind).toBe("pdf-rects");
});

it("places a spilled-over annotation on both of its pages", () => {
  const grouped = groupAnnotationsByPage([
    record("PUPR5FG5", "highlight", {
      pageIndex: 3,
      rects: [RECT],
      nextPageRects: [[100, 80, 200, 100]],
    }),
  ]);

  expect([...grouped.keys()].toSorted((a, b) => a - b)).toEqual([3, 4]);
  expect(grouped.get(4)?.[0]?.annotation.key).toBe("PUPR5FG5");
});

it("drops an annotation whose position is not a PDF position", () => {
  const grouped = groupAnnotationsByPage([
    {
      key: "EPUBMRK2",
      type: "highlight",
      color: "#ffd400",
      comment: null,
      text: null,
      parentKey: "EPUBBK23",
      pageLabel: null,
      sortIndex: "00000|000000|00000",
      tags: [],
      position: parseAnnotationPosition(
        { type: "FragmentSelector", value: "epubcfi(/6/4!/4/2)" },
        "application/epub+zip",
      ),
      version: null,
    },
  ]);

  expect(grouped.size).toBe(0);
});

describe("the ink hit test", () => {
  /**
   * A square loop 100 points on a side, in PDF points: in page units its
   * strokes run along x = 100 and 200 and y = 92 and 192, round an empty
   * middle.
   */
  const LOOP = [[100, 600, 200, 600, 200, 700, 100, 700, 100, 600]];

  /** The page laid out at 100 % from the origin: client pixels are page units. */
  const PAGE_BOX: PageBox = {
    left: 0,
    top: 0,
    width: 612,
    height: 792,
    unitWidth: 612,
    unitHeight: 792,
  };

  /** The marks a click takes on `PAGE_BOX`. */
  function clickedAt(
    records: readonly AnnotationRecord[],
    x: number,
    y: number,
  ): string[] {
    const at = pagePointOf(PAGE_BOX, { x, y })!;
    return marksAtPoint(markTargets(pageView(), pageAnnotations(records)), at);
  }

  const ink = (width: number, paths: number[][]) =>
    record("4PE492KU", "ink", { pageIndex: 0, width, paths });

  it("takes no click in the empty middle of a loop", () => {
    expect(clickedAt([ink(2, LOOP)], 150, 142)).toEqual([]);
    // Ten units inside the bottom stroke is past the seven-point reach.
    expect(clickedAt([ink(2, LOOP)], 150, 182)).toEqual([]);
  });

  it("takes a click closer than seven points to a thin stroke", () => {
    // Zotero's test is strict: exactly the reach away is a miss.
    expect(clickedAt([ink(2, LOOP)], 150, 192)).toEqual(["4PE492KU"]);
    expect(clickedAt([ink(2, LOOP)], 150, 198.5)).toEqual(["4PE492KU"]);
    expect(clickedAt([ink(2, LOOP)], 150, 199)).toEqual([]);
  });

  it("reaches a wide pen's full width from its stroke", () => {
    expect(clickedAt([ink(30, LOOP)], 150, 221.5)).toEqual(["4PE492KU"]);
    expect(clickedAt([ink(30, LOOP)], 150, 222)).toEqual([]);
  });

  it("measures to the segments, so sparse points still take a click between them", () => {
    // A 90-degree turn with no vertex along its 100-point arms.
    const turn = [[100, 600, 200, 600, 200, 700]];
    expect(clickedAt([ink(2, turn)], 150, 192)).toEqual(["4PE492KU"]);
  });

  it("takes a click on a single-point dot, and on straight ink with a flat box", () => {
    expect(clickedAt([ink(4, [[100, 600]])], 103, 195)).toEqual(["4PE492KU"]);
    expect(clickedAt([ink(4, [[100, 600]])], 100, 199)).toEqual([]);
    expect(clickedAt([ink(2, [[100, 600, 200, 600]])], 150, 196)).toEqual([
      "4PE492KU",
    ]);
  });

  it("hangs the Mark Popup of a dot under the dot", () => {
    const [target] = markTargets(
      pageView(),
      pageAnnotations([ink(4, [[100, 600]])]),
    );
    // The pen's half-width of 2 below y = 192.
    expect(markAnchor(target?.rects ?? [], PAGE_BOX)).toEqual({
      x: 100,
      y: 194,
    });
  });
});

/** An image region on page zero, `[x1, y1, x2, y2]` in PDF points. */
function figure(rect = [100, 300, 300, 500]): AnnotationRecord {
  return record("FDRFQ7C2", "image", { pageIndex: 0, rects: [rect] });
}

/** Each handle's `[x, y, width, height]`, by the grip it names. */
function handlesIn(page: OverlayPageView): Record<string, number[]> {
  return Object.fromEntries(
    [
      ...page.div.querySelectorAll<SVGElement>(
        `.${themeHook.pdfAnnotationHandle}`,
      ),
    ].map((handle) => [
      handle.dataset.ztGrip,
      ["x", "y", "width", "height"].map((name) =>
        round(handle.getAttribute(name)),
      ),
    ]),
  );
}

it("draws eight Mark Handles on the selected image, five pixels either side", () => {
  // At scale 2 one page unit is two pixels, so a ten-pixel handle is five
  // units wide. The bottom-right corner (300, 300) sits at y 792 - 300.
  const page = pageView(viewport({ scale: 2 }));

  renderAnnotationOverlay(page, {
    font: MONO,
    annotations: pageAnnotations([figure()]),
    selected: new Set(["FDRFQ7C2"]),
    handles: true,
  });

  expect(handlesIn(page)).toEqual({
    tl: [97.5, 289.5, 5, 5],
    t: [197.5, 289.5, 5, 5],
    tr: [297.5, 289.5, 5, 5],
    r: [297.5, 389.5, 5, 5],
    br: [297.5, 489.5, 5, 5],
    b: [197.5, 489.5, 5, 5],
    bl: [97.5, 489.5, 5, 5],
    l: [97.5, 389.5, 5, 5],
  });
  // The public hook, and the cursor each handle shows over an upright page.
  const corner = page.div.querySelector<SVGElement>('[data-zt-grip="tr"]')!;
  expect([...corner.classList]).toEqual(["zt-pdf-annotation-handle"]);
  expect(corner.dataset.ztCursor).toBe("nesw-resize");
  // The body of the image moves it, so it takes the pointer too.
  expect(markIn(page, "FDRFQ7C2").dataset.ztGrip).toBe("body");
  expect(markIn(page, "FDRFQ7C2").dataset.ztCursor).toBe("move");
});

it("draws each Mark Handle where a press on it is measured, on a page turned a quarter turn", () => {
  // A quarter turn lays PDF (x, y) at page units (y, x), and at scale 1.5 a
  // unit is one and a half pixels, so a ten-pixel handle is 20/3 units wide.
  // The bottom-right corner (300, 300) stands at (300, 300); the top-left
  // corner (100, 500) at (500, 100). selection.test.ts presses there.
  const page = pageView(viewport({ rotation: 90, scale: 1.5 }));

  renderAnnotationOverlay(page, {
    font: MONO,
    annotations: pageAnnotations([figure()]),
    selected: new Set(["FDRFQ7C2"]),
    handles: true,
  });

  const side = 20 / 3;
  const around = ({ x, y }: { x: number; y: number }) =>
    [x - side / 2, y - side / 2, side, side].map((value) =>
      round(String(value)),
    );
  expect(handlesIn(page).br).toEqual(around({ x: 300, y: 300 }));
  expect(handlesIn(page).tl).toEqual(around({ x: 500, y: 100 }));
  expect(unitPointOf(page, [300, 300])).toEqual({ x: 300, y: 300 });
  expect(HANDLE_RADIUS * unitsPerPixel(page)).toBeCloseTo(side / 2, 9);
});

it("draws no Mark Handle while editing is not live, or off the selection", () => {
  const drawn = (options: {
    selected?: ReadonlySet<string>;
    handles?: boolean;
  }) => {
    const page = pageView();
    renderAnnotationOverlay(page, {
      font: MONO,
      annotations: pageAnnotations([figure(), highlight()]),
      ...options,
    });
    return {
      handles: Object.keys(handlesIn(page)),
      body: markIn(page, "FDRFQ7C2").dataset.ztGrip,
    };
  };

  expect(drawn({ selected: new Set(["FDRFQ7C2"]) })).toEqual({
    handles: [],
    body: undefined,
  });
  expect(drawn({ handles: true })).toEqual({ handles: [], body: undefined });
});

it("draws a selected highlight's two end strips, three pixels either side of its edges", () => {
  // At scale 2 one page unit is two pixels, so a strip six pixels wide is
  // three units wide. `RECT` spans x 100–200 and lands at y 72–92.
  const page = pageView(viewport({ scale: 2 }));

  renderAnnotationOverlay(page, {
    font: MONO,
    annotations: pageAnnotations([highlight()]),
    selected: new Set(["PUPR5FG5"]),
    handles: true,
  });

  expect(handlesIn(page)).toEqual({
    start: [98.5, 72, 3, 20],
    end: [198.5, 72, 3, 20],
  });
  const end = page.div.querySelector<SVGElement>('[data-zt-grip="end"]')!;
  expect(end.dataset.ztCursor).toBe("ew-resize");
  // The body stays the text selection's.
  expect(markIn(page, "PUPR5FG5").dataset.ztGrip).toBeUndefined();
});

it("turns a selected range's strips, and their cursor, with the text under them", () => {
  // `RECT` spans x 100–200 and y 700–720; text turned a quarter turn reads up
  // the page, so at scale 2 the start's strip is three units high across the
  // rect's foot, y 792 - 700 = 92 in page units, and the end's across its
  // head, at 72.
  const page = pageView(viewport({ scale: 2 }));

  renderAnnotationOverlay(page, {
    font: MONO,
    annotations: pageAnnotations([highlight()]),
    selected: new Set(["PUPR5FG5"]),
    handles: true,
    textRotation: () => 90,
  });

  expect(handlesIn(page)).toEqual({
    start: [100, 90.5, 100, 3],
    end: [100, 70.5, 100, 3],
  });
  const end = page.div.querySelector<SVGElement>('[data-zt-grip="end"]')!;
  expect(end.dataset.ztCursor).toBe("ns-resize");
});

it("draws a spilled-over range's start on its first page and its end on the next", () => {
  const spilled = record("PUPR5FG5", "highlight", {
    pageIndex: 0,
    rects: [RECT],
    nextPageRects: [[72, 740, 150, 752]],
  });
  const grouped = groupAnnotationsByPage([spilled]);
  const drawnOn = (pageIndex: number) => {
    const page = pageView();
    renderAnnotationOverlay(page, {
      font: MONO,
      annotations: grouped.get(pageIndex) ?? [],
      selected: new Set(["PUPR5FG5"]),
      handles: true,
    });
    return Object.keys(handlesIn(page));
  };

  expect(drawnOn(0)).toEqual(["start"]);
  expect(drawnOn(1)).toEqual(["end"]);
});

it("patches the selected mark, its outline, and its handles in place", () => {
  const page = pageView();
  renderAnnotationOverlay(page, {
    font: MONO,
    annotations: pageAnnotations([figure(), highlight()]),
    selected: new Set(["FDRFQ7C2"]),
    handles: true,
  });
  const overlay = overlayIn(page);
  const mark = markIn(page, "FDRFQ7C2");
  const children = [...overlay.children];

  const patched = patchSelectedMark(
    page,
    pageAnnotations([figure([100, 280, 340, 500])])[0]!,
    {
      handles: true,
      font: MONO,
    },
  );

  expect(patched).toBe(true);
  // The same nodes, carrying the new geometry.
  expect(overlayIn(page)).toBe(overlay);
  expect([...overlay.children]).toEqual(children);
  expect(markIn(page, "FDRFQ7C2")).toBe(mark);
  expect(rectOf(page, "FDRFQ7C2")).toEqual(["100", "292", "240", "220"]);
  expect(
    overlay
      .querySelector(`.${themeHook.pdfAnnotationSelectionOutline}`)!
      .getAttribute("d"),
  ).toBe("M 98.5 290.5 L 341.5 290.5 L 341.5 513.5 L 98.5 513.5 Z");
  expect(handlesIn(page).br).toEqual([335, 507, 10, 10]);
  // The neighbour is left as it stood.
  expect(rectOf(page, "PUPR5FG5")).toEqual(["100", "72", "100", "20"]);
});

it("patches a scaled ink stroke, the width of its casing, and its four handles in place", () => {
  const stroke = (paths: number[][], width: number) =>
    record("4PE492KU", "ink", { pageIndex: 0, width, paths });
  const page = pageView();
  renderAnnotationOverlay(page, {
    font: MONO,
    annotations: pageAnnotations([stroke([[100, 300, 200, 400]], 2)]),
    selected: new Set(["4PE492KU"]),
    handles: true,
  });
  const overlay = overlayIn(page);
  const children = [...overlay.children];
  // The body of the ink moves it, and only its four corners scale it.
  expect(markIn(page, "4PE492KU").dataset.ztGrip).toBe("body");
  expect(Object.keys(handlesIn(page)).sort()).toEqual(["bl", "br", "tl", "tr"]);

  // Doubled from the top-left corner: twice the size, twice the pen.
  const patched = patchSelectedMark(
    page,
    pageAnnotations([stroke([[100, 200, 300, 400]], 4)])[0]!,
    { handles: true, font: MONO },
  );

  expect(patched).toBe(true);
  expect([...overlay.children]).toEqual(children);
  const mark = markIn(page, "4PE492KU");
  expect(mark.getAttribute("d")).toBe("M 100 592 L 100 592 L 300 392");
  expect(mark.getAttribute("stroke-width")).toBe("4");
  // The casing rides the pen's new width, padded 1.5 units either side.
  const casing = overlay.querySelector<SVGElement>(
    `.${themeHook.pdfAnnotationSelectionOutline}`,
  )!;
  expect(casing.getAttribute("d")).toBe("M 100 592 L 100 592 L 300 392");
  expect(casing.style.strokeWidth).toBe("7");
  // The bottom-right handle stands five units out from (300, 200).
  expect(handlesIn(page).br).toEqual([300, 592, 10, 10]);
});

it("draws a proposed position in the mark's own place in its page's list", () => {
  const marks = groupAnnotationsByPage([figure(), highlight()]);

  const proposed = withPosition(marks, "FDRFQ7C2", {
    kind: "pdf-rects",
    pageIndex: 0,
    rects: [[100, 280, 340, 500]],
  });

  expect(
    proposed.get(0)?.map(({ annotation, rects }) => [annotation.key, rects]),
  ).toEqual([
    ["FDRFQ7C2", [[100, 280, 340, 500]]],
    ["PUPR5FG5", [RECT]],
  ]);
});

it("patches nothing on a page whose overlay holds no such mark", () => {
  const page = pageView();
  renderAnnotationOverlay(page, {
    font: MONO,
    annotations: pageAnnotations([highlight()]),
  });

  expect(
    patchSelectedMark(page, pageAnnotations([figure()])[0]!, {
      handles: true,
      font: MONO,
    }),
  ).toBe(false);
});

/** The highlight the geometry cases place, on `RECT`. */
function highlight(): AnnotationRecord {
  return record("PUPR5FG5", "highlight", {
    pageIndex: 0,
    rects: [RECT],
  });
}

/** The shared builder, dressed in the colour and comment the Fixture gives it. */
function record(
  key: string,
  type: AnnotationRecord["type"],
  position: unknown,
): AnnotationRecord {
  return {
    ...annotation(key, type, position),
    color: FIXTURE_COLORS[key] ?? null,
    comment: type === "text" ? "Making figures is hard :(" : null,
  };
}

/** Everything the records place on page zero. */
function pageAnnotations(records: readonly AnnotationRecord[]) {
  return groupAnnotationsByPage(records).get(0) ?? [];
}

function pageView(built = viewport()): OverlayPageView {
  return { div: document.createElement("div"), viewport: built };
}

function overlayIn(page: OverlayPageView): SVGElement {
  return page.div.querySelector<SVGElement>(
    `.${themeHook.pdfAnnotationOverlay}`,
  )!;
}

function markIn(page: OverlayPageView, key: string): SVGElement {
  return page.div.querySelector<SVGElement>(
    `[data-zotero-annotation-key="${key}"]`,
  )!;
}

/** The mark's `[x, y, width, height]`, as the overlay wrote them. */
function rectOf(page: OverlayPageView, key: string): (string | null)[] {
  const mark = markIn(page, key);
  return ["x", "y", "width", "height"].map((name) => mark.getAttribute(name));
}

/** PDF points carry three decimals; the rest is the float noise of the sum. */
function round(value: string | null): number {
  return Math.round(Number(value) * 1000) / 1000;
}

/** The named coordinate attributes of a mark, at PDF-point precision. */
function pointsOf(
  page: OverlayPageView,
  key: string,
  names: readonly string[],
): number[] {
  const mark = markIn(page, key);
  return names.map((name) => round(mark.getAttribute(name)));
}

/**
 * An ink mark's path, as the points its line-tos draw at PDF-point precision;
 * each stroke's move-to only puts the pen down on its first point.
 */
function pathOf(page: OverlayPageView, key: string): number[][] {
  const commands = markIn(page, key)
    .getAttribute("d")!
    .split(/(?=[ML])/)
    .filter((command) => command.startsWith("L"));
  return commands.map((command) =>
    command.trim().slice(1).trim().split(" ").map(round),
  );
}

/** A free-text mark's lines, each beside where its baseline starts. */
function linesOf(
  page: OverlayPageView,
  key: string,
): [string, number, number][] {
  return [...markIn(page, key).children].map((line) => [
    line.textContent ?? "",
    round(line.getAttribute("x")),
    round(line.getAttribute("y")),
  ]);
}

function attributesOf(
  page: OverlayPageView,
  key: string,
): Record<string, string> {
  return Object.fromEntries(
    [...markIn(page, key).attributes].map(({ name, value }) => [name, value]),
  );
}

/** Every mark, as its tag name beside the Zotero type it was drawn for. */
function marksIn(page: OverlayPageView): Record<string, string[]> {
  return Object.fromEntries(
    [
      ...page.div.querySelectorAll<SVGElement>("[data-zotero-annotation-key]"),
    ].map((mark) => [
      mark.dataset.zoteroAnnotationKey,
      [mark.tagName, mark.dataset.zoteroAnnotationType],
    ]),
  );
}
