// @vitest-environment happy-dom
import { expect, it } from "vitest";

import { parseAnnotationPosition } from "@zotlit/db";

import { themeHook } from "@/lib/theme-hooks";
import type { AnnotationRecord } from "@/services/annotation-repository/service";

import { annotation, viewport } from "./__fixtures__";
import { groupAnnotationsByPage, renderAnnotationOverlay } from "./render";
import type { OverlayPageView } from "./render";

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
  // The ink stroke keeps the width Zotero stored, in the page's own points.
  expect(pathOf(page, "TYY6Z6ZF")).toEqual([
    [66.964, 117.652],
    [66.629, 118.74],
  ]);
  expect(attributesOf(page, "TYY6Z6ZF")).toMatchObject({
    fill: "none",
    stroke: "#5fb236",
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
  // The free text is the comment, at the size Zotero stored.
  expect(markIn(page, "HRK7BG32").textContent).toBe(
    "Making figures is hard :(",
  );
  expect(attributesOf(page, "HRK7BG32")["font-size"]).toBe("14");
});

it.each(ROTATIONS)(
  "places a mark where PDF.js's own transform puts it at rotation $rotation",
  ({ rotation, box, mark }) => {
    const page = pageView(viewport({ rotation }));

    renderAnnotationOverlay(page, {
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
    annotations: pageAnnotations([highlight()]),
  });

  expect(overlayIn(page).getAttribute("viewBox")).toBe("0 0 612 792");
  expect(rectOf(page, "PUPR5FG5")).toEqual(["90", "92", "100", "20"]);
});

it("builds the same overlay at every zoom step", () => {
  const markup = (scale: number) => {
    const page = pageView(viewport({ scale }));
    renderAnnotationOverlay(page, {
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
    annotations: annotations.get(0) ?? [],
  });
  renderAnnotationOverlay(second, {
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

it("draws no outline for a mark the caller left unselected", () => {
  const page = pageView();

  renderAnnotationOverlay(page, {
    annotations: pageAnnotations([highlight()]),
  });

  expect(
    overlayIn(page).querySelector(".zt-pdf-annotation-selection-outline"),
  ).toBeNull();
});

it("leaves the page as it found it when the annotations are gone", () => {
  const page = pageView();
  renderAnnotationOverlay(page, {
    annotations: pageAnnotations([highlight()]),
  });

  renderAnnotationOverlay(page, { annotations: [] });

  expect(page.div.childElementCount).toBe(0);
});

it("draws nothing for a type whose stored position is not the shape it pairs with", () => {
  const page = pageView();

  renderAnnotationOverlay(page, {
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

/** An ink mark's path, as its points at PDF-point precision. */
function pathOf(page: OverlayPageView, key: string): number[][] {
  const commands = markIn(page, key)
    .getAttribute("d")!
    .split(/(?=[ML])/);
  return commands.map((command) =>
    command.trim().slice(1).trim().split(" ").map(round),
  );
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
