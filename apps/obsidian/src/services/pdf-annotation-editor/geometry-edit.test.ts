import { expect, it } from "vitest";

import { parseAnnotationPosition } from "@zotlit/db";
import type {
  AnnotationPositionRaw,
  PdfInkPosition,
  PdfRectsPosition,
  PdfTextPosition,
} from "@zotlit/db";

import {
  bodyRect,
  captureRect,
  capturesImage,
  gripAt,
  gripCursor,
  handleLayout,
  keyedPosition,
  keyEdit,
  proposePosition,
  rangeGripAt,
  rangeHandles,
  releasedPosition,
  sameGeometry,
} from "./geometry-edit";
import type { Grip } from "./geometry-edit";

/** A US Letter page seen from a non-zero origin, as a PDF may describe it. */
const VIEW_BOX = [10, 20, 622, 812] as const;

/**
 * A free-text box 100 × 20 points at font size 10, and a fixed-width measure:
 * every character is half the font size wide, so "hello" is 25 points and a
 * line is 12 points high. A box is laid out at its own width once it is 20
 * points high.
 */
const TEXT_CONTENT = {
  comment: "hello",
  measure: (text: string, fontSize: number) => text.length * fontSize * 0.5,
};

/** An image region well inside that page, `[x1, y1, x2, y2]` in PDF points. */
const IMAGE = rects([[100, 300, 300, 500]]);

function rects(value: number[][]): PdfRectsPosition {
  return parseAnnotationPosition(
    { pageIndex: 1, rects: value } as unknown as AnnotationPositionRaw,
    "application/pdf",
  ) as PdfRectsPosition;
}

/** The one rect the image drag proposes, for a held grip moved by a delta. */
function drag(grip: Grip, [dx, dy]: [number, number], confirmed = IMAGE) {
  const from = [200, 400] as const;
  const proposed = proposePosition({
    confirmed,
    grip,
    from,
    to: [from[0] + dx, from[1] + dy],
    viewBox: VIEW_BOX,
    text: TEXT_CONTENT,
  }) as PdfRectsPosition;
  return proposed.rects[0];
}

it("never lets a resize shrink the image below ten points, from any edge", () => {
  // Each edge dragged far past the opposite one stops ten points short of it.
  expect(drag("l", [500, 0])).toEqual([290, 300, 300, 500]);
  expect(drag("r", [-500, 0])).toEqual([100, 300, 110, 500]);
  expect(drag("b", [0, 500])).toEqual([100, 490, 300, 500]);
  expect(drag("t", [0, -500])).toEqual([100, 300, 300, 310]);
  // A corner holds both of its edges to the minimum at once.
  expect(drag("tr", [-500, -500])).toEqual([100, 300, 110, 310]);
  expect(drag("bl", [500, 500])).toEqual([290, 490, 300, 500]);
});

it("clamps each dragged edge to the page's view box", () => {
  expect(drag("l", [-500, 0])).toEqual([10, 300, 300, 500]);
  expect(drag("r", [900, 0])).toEqual([100, 300, 622, 500]);
  expect(drag("b", [0, -900])).toEqual([100, 20, 300, 500]);
  expect(drag("t", [0, 900])).toEqual([100, 300, 300, 812]);
  expect(drag("br", [900, -900])).toEqual([100, 20, 622, 500]);
});

it("moves only the edges a grip holds, by the pointer's travel", () => {
  expect(drag("br", [40, -25])).toEqual([100, 275, 340, 500]);
  expect(drag("tl", [-15, 5])).toEqual([85, 300, 300, 505]);
  // An edge midpoint moves one edge and ignores travel along it.
  expect(drag("r", [30, 70])).toEqual([100, 300, 330, 500]);
  expect(drag("t", [30, 70])).toEqual([100, 300, 300, 570]);
});

it("moves the whole rect by its body and keeps every edge on the page", () => {
  expect(drag("body", [12.5, -40])).toEqual([112.5, 260, 312.5, 460]);
  // Pushed past the page's right and bottom edges, the rect stops flush with
  // them and keeps its own size.
  expect(drag("body", [900, -900])).toEqual([422, 20, 622, 220]);
  expect(drag("body", [-900, 900])).toEqual([10, 612, 210, 812]);
});

it("keeps the page index and every field but the rect", () => {
  const proposed = proposePosition({
    confirmed: IMAGE,
    grip: "br",
    from: [300, 300],
    to: [310, 290],
    viewBox: VIEW_BOX,
    text: TEXT_CONTENT,
  });

  expect(proposed).toEqual({
    kind: "pdf-rects",
    pageIndex: 1,
    rects: [[100, 290, 310, 500]],
  });
});

it("proposes the confirmed geometry for a release that did not move", () => {
  const still = proposePosition({
    confirmed: IMAGE,
    grip: "br",
    from: [300, 300],
    to: [300, 300],
    viewBox: VIEW_BOX,
    text: TEXT_CONTENT,
  });

  expect(sameGeometry(still, IMAGE)).toBe(true);
});

it("counts geometry the same once both round to three decimals", () => {
  expect(sameGeometry(rects([[100.0004, 300, 300, 500]]), IMAGE)).toBe(true);
  expect(sameGeometry(rects([[100.001, 300, 300, 500]]), IMAGE)).toBe(false);
});

it("lays an image's eight handles on its corners and edge midpoints", () => {
  const handles = handleLayout({ type: "image", position: IMAGE });

  expect(Object.fromEntries(handles.map(({ grip, at }) => [grip, at]))).toEqual(
    {
      tl: [100, 500],
      t: [200, 500],
      tr: [300, 500],
      r: [300, 400],
      br: [300, 300],
      b: [200, 300],
      bl: [100, 300],
      l: [100, 400],
    },
  );
});

it("lays no handle on a mark this build cannot yet adjust", () => {
  expect(handleLayout({ type: "highlight", position: IMAGE })).toEqual([]);
});

/** An ink position on page index 1, from flat `[x, y, x, y, …]` strokes. */
function ink(paths: number[][], width = 2): PdfInkPosition {
  return parseAnnotationPosition(
    { pageIndex: 1, width, paths } as unknown as AnnotationPositionRaw,
    "application/pdf",
  ) as PdfInkPosition;
}

/** A square stroke box, `[100, 300, 200, 400]`, drawn as its diagonal. */
const SQUARE = ink([[100, 300, 150, 350, 200, 400]]);

/** Two strokes spanning `[100, 300, 300, 400]`: twice as wide as high. */
const WIDE = ink([
  [100, 300, 200, 350],
  [250, 380, 300, 400],
]);

/** The ink a drag proposes, for a held grip moved by a delta, with float
 * noise past the sixth decimal cut off. */
function dragInk(
  grip: Grip,
  [dx, dy]: [number, number],
  confirmed: PdfInkPosition,
): PdfInkPosition {
  const from = [150, 350] as const;
  const proposed = proposePosition({
    confirmed,
    grip,
    from,
    to: [from[0] + dx, from[1] + dy],
    viewBox: VIEW_BOX,
    text: TEXT_CONTENT,
  }) as PdfInkPosition;
  const round = (value: number) => Math.round(value * 1e6) / 1e6;
  return {
    ...proposed,
    width: round(proposed.width),
    paths: proposed.paths.map((path) => path.map(round)),
  };
}

it("gives ink with no area no scale handles, whatever its strokes", () => {
  // A dot, a flat line, and an upright line: each box lacks a dimension a
  // proportional scale could keep.
  expect(handleLayout({ type: "ink", position: ink([[5, 5]]) })).toEqual([]);
  expect(handleLayout({ type: "ink", position: ink([[0, 5, 40, 5]]) })).toEqual(
    [],
  );
  expect(handleLayout({ type: "ink", position: ink([[5, 0, 5, 40]]) })).toEqual(
    [],
  );
});

it("translates every point of every stroke by the body's travel, width kept", () => {
  expect(dragInk("body", [12.5, -40], WIDE)).toEqual(
    ink([
      [112.5, 260, 212.5, 310],
      [262.5, 340, 312.5, 360],
    ]),
  );
});

it("moves ink by its body only as far as its strokes stay on the page", () => {
  // The strokes span [100, 300, 300, 400]; the view box is [10, 20, 622, 812].
  expect(dragInk("body", [900, -900], WIDE)).toEqual(
    ink([
      [422, 20, 522, 70],
      [572, 100, 622, 120],
    ]),
  );
  expect(dragInk("body", [-900, 900], WIDE)).toEqual(
    ink([
      [10, 712, 110, 762],
      [160, 792, 210, 812],
    ]),
  );
});

it("scales ink from each corner with its proportions held, the opposite corner fixed", () => {
  // Pulled 100 points outward along x, the square doubles to 200 points a
  // side, anchored at the corner opposite the one held.
  expect(dragInk("br", [100, 0], SQUARE).paths).toEqual([
    [100, 200, 200, 300, 300, 400],
  ]);
  expect(dragInk("tr", [100, 0], SQUARE).paths).toEqual([
    [100, 300, 200, 400, 300, 500],
  ]);
  expect(dragInk("bl", [-100, 0], SQUARE).paths).toEqual([
    [0, 200, 100, 300, 200, 400],
  ]);
  expect(dragInk("tl", [-100, 0], SQUARE).paths).toEqual([
    [0, 300, 100, 400, 200, 500],
  ]);
});

it("scales the stroke width by the square root of the area scale", () => {
  // Twice as wide and twice as high is four times the area: the pen doubles.
  expect(dragInk("tr", [200, 0], WIDE)).toEqual(
    ink(
      [
        [100, 300, 300, 400],
        [400, 460, 500, 500],
      ],
      4,
    ),
  );
  // Halved on each side, a quarter of the area: the pen halves.
  expect(dragInk("br", [-50, 0], SQUARE).width).toBe(1);
});

it("lets the horizontal travel alone set an ink corner's scale, as Zotero does", () => {
  expect(dragInk("br", [0, -300], SQUARE)).toEqual(SQUARE);
});

it("never scales ink below one point on either side", () => {
  // The wide strokes are 200 by 100 points: dragged far past the opposite
  // edge, the scale stops where the shorter side reaches one point.
  const shrunk = dragInk("br", [-900, 0], WIDE);
  expect(shrunk.paths).toEqual([
    [100, 399, 101, 399.5],
    [101.5, 399.8, 102, 400],
  ]);
  expect(shrunk.width).toBe(0.02);
});

it("lays ink's four corner handles on its stroke box, padded out", () => {
  const handles = handleLayout({ type: "ink", position: WIDE });

  expect(Object.fromEntries(handles.map(({ grip, at }) => [grip, at]))).toEqual(
    {
      tl: [95, 405],
      tr: [305, 405],
      br: [305, 295],
      bl: [95, 295],
    },
  );
});

it("takes the body of image and ink by its box, and of no other mark", () => {
  expect(bodyRect({ type: "image", position: IMAGE })).toEqual([
    100, 300, 300, 500,
  ]);
  expect(bodyRect({ type: "ink", position: WIDE })).toEqual([
    95, 295, 305, 405,
  ]);
  // A dot can still be moved by the box padded round it.
  expect(bodyRect({ type: "ink", position: ink([[5, 5]]) })).toEqual([
    0, 0, 10, 10,
  ]);
  expect(bodyRect({ type: "highlight", position: IMAGE })).toBeNull();
});

it("gives a corner priority over an edge whose handle covers the same point", () => {
  // A ten-point image at a zoom where each handle's reach overlaps its
  // neighbours': the point sits inside the top-right corner's square and the
  // top and right midpoints' squares at once.
  const handles = [
    { grip: "t", at: { x: 5, y: 0 } },
    { grip: "r", at: { x: 10, y: 5 } },
    { grip: "tr", at: { x: 10, y: 0 } },
    { grip: "tl", at: { x: 0, y: 0 } },
  ] as const;

  expect(
    gripAt({ handles, body: null, point: { x: 7, y: 2 }, radius: 5 }),
  ).toBe("tr");
  // Between two corners, the one Zotero tries first wins.
  expect(
    gripAt({ handles, body: null, point: { x: 5, y: 1 }, radius: 5 }),
  ).toBe("tr");
});

it("takes the body inside the mark, and nothing outside every handle and the body", () => {
  const handles = [{ grip: "br", at: { x: 100, y: 100 } }] as const;
  const body = [0, 0, 100, 100] as const;

  expect(gripAt({ handles, body, point: { x: 97, y: 97 }, radius: 5 })).toBe(
    "br",
  );
  expect(gripAt({ handles, body, point: { x: 50, y: 50 }, radius: 5 })).toBe(
    "body",
  );
  expect(
    gripAt({ handles, body, point: { x: 150, y: 50 }, radius: 5 }),
  ).toBeNull();
  expect(
    gripAt({ handles, body: null, point: { x: 50, y: 50 }, radius: 5 }),
  ).toBeNull();
});

it("points the cursor along the edge a handle moves, as the page is turned", () => {
  expect(
    (["l", "t", "tl", "tr", "body"] as const).map((grip) =>
      gripCursor(grip, 0),
    ),
  ).toEqual(["ew-resize", "ns-resize", "nwse-resize", "nesw-resize", "move"]);
  // A quarter turn lays the page's horizontal edges upright.
  expect(
    (["l", "t", "tl", "tr", "body"] as const).map((grip) =>
      gripCursor(grip, 90),
    ),
  ).toEqual(["ns-resize", "ew-resize", "nesw-resize", "nwse-resize", "move"]);
  expect(gripCursor("tr", 180)).toBe("nesw-resize");
});

/** A highlight's staircase: two lines on page 1, spilling onto page 2. */
const STAIRCASE = parseAnnotationPosition(
  {
    pageIndex: 1,
    rects: [
      [200, 700, 400, 712],
      [72, 686, 300, 698],
    ],
    nextPageRects: [[72, 740, 150, 752]],
  } as unknown as AnnotationPositionRaw,
  "application/pdf",
) as PdfRectsPosition;

/** Upright text under every rect. */
const upright = () => 0;

it("lays a range's handles on the leading edge of its first line and the trailing edge of its last", () => {
  expect(
    rangeHandles({ type: "highlight", position: STAIRCASE }, 3, upright),
  ).toEqual([
    { grip: "start", pageIndex: 1, rect: [197, 700, 203, 712], rotation: 0 },
    { grip: "end", pageIndex: 2, rect: [147, 740, 153, 752], rotation: 0 },
  ]);
  const onePage = rects([[100, 300, 160, 312]]);
  expect(
    rangeHandles({ type: "underline", position: onePage }, 2, upright),
  ).toEqual([
    { grip: "start", pageIndex: 1, rect: [98, 300, 102, 312], rotation: 0 },
    { grip: "end", pageIndex: 1, rect: [158, 300, 162, 312], rotation: 0 },
  ]);
  // An image or ink is resized by its own handles.
  expect(rangeHandles({ type: "image", position: IMAGE }, 3, upright)).toEqual(
    [],
  );
});

it("lays a range's handles across text turned a quarter turn, which reads up the page", () => {
  // One column of text from y 300 up to y 360, x 100 to 112: the start
  // stands on its foot and the end on its head.
  const column = rects([[100, 300, 112, 360]]);
  const asked: unknown[] = [];
  const turned = (pageIndex: number, rect: readonly number[]) => {
    asked.push([pageIndex, rect]);
    return 90;
  };

  expect(
    rangeHandles({ type: "highlight", position: column }, 3, turned),
  ).toEqual([
    { grip: "start", pageIndex: 1, rect: [100, 297, 112, 303], rotation: 90 },
    { grip: "end", pageIndex: 1, rect: [100, 357, 112, 363], rotation: 90 },
  ]);
  // Each end asks for the text under its own rect.
  expect(asked).toEqual([
    [1, [100, 300, 112, 360]],
    [1, [100, 300, 112, 360]],
  ]);
});

it("takes a range's handle from the page it is drawn on, and never its body", () => {
  const handles = rangeHandles(
    { type: "highlight", position: STAIRCASE },
    3,
    upright,
  );
  const at =
    (pageIndex: number, point: readonly [number, number]) => (page: number) =>
      page === pageIndex ? point : null;

  expect(rangeGripAt(handles, at(1, [199, 705]))).toBe("start");
  expect(rangeGripAt(handles, at(2, [152, 745]))).toBe("end");
  // The end's strip on page 2 is not reached by the same point on page 1.
  expect(rangeGripAt(handles, at(1, [152, 745]))).toBeNull();
  // Inside the highlight, text selection keeps the press.
  expect(rangeGripAt(handles, at(1, [300, 705]))).toBeNull();
});

it("gives the start the press where a one-character range's strips overlap", () => {
  const handles = rangeHandles(
    { type: "highlight", position: rects([[100, 300, 104, 312]]) },
    3,
    upright,
  );

  expect(rangeGripAt(handles, () => [102, 305])).toBe("start");
});

it("points a range handle's cursor along the text, as the page is turned", () => {
  expect(gripCursor("end", 0)).toBe("ew-resize");
  expect(gripCursor("start", 90)).toBe("ns-resize");
});

/** The one rect a key press proposes for the image, or `null` if refused. */
function keyImage(
  edit: "resize" | "nudge",
  arrow: "left" | "right" | "up" | "down",
  confirmed = IMAGE,
) {
  const keyed = keyedPosition({
    confirmed,
    edit,
    arrow,
    viewBox: VIEW_BOX,
    text: TEXT_CONTENT,
  });
  return keyed && (keyed.proposal as PdfRectsPosition).rects[0];
}

it("reads which Geometry Edit a modified arrow asks of each kind of mark", () => {
  const plain = { shift: false, alt: false, mod: false };
  expect(keyEdit("highlight", { ...plain, shift: true })).toEqual({
    kind: "range",
    end: "end",
  });
  expect(keyEdit("underline", { ...plain, shift: true, mod: true })).toEqual({
    kind: "range",
    end: "start",
  });
  expect(keyEdit("image", { ...plain, shift: true })).toEqual({
    kind: "resize",
  });
  expect(keyEdit("ink", { ...plain, alt: true })).toEqual({ kind: "nudge" });
  // Plain arrows walk the reading order, and the other chords are no edit.
  expect(keyEdit("image", plain)).toBeNull();
  expect(keyEdit("highlight", plain)).toBeNull();
  expect(keyEdit("highlight", { ...plain, alt: true })).toBeNull();
  expect(keyEdit("image", { ...plain, shift: true, mod: true })).toBeNull();
  expect(keyEdit("image", { ...plain, shift: true, alt: true })).toBeNull();
  expect(keyEdit("note", { ...plain, shift: true })).toBeNull();
});

it("resizes an image by five points on its right edge, or its bottom, as Zotero's keys do", () => {
  // The image is [100, 300, 300, 500]: Right and Left move x2, Down and Up
  // move y1, the foot of the rect in PDF space.
  expect(keyImage("resize", "right")).toEqual([100, 300, 305, 500]);
  expect(keyImage("resize", "left")).toEqual([100, 300, 295, 500]);
  expect(keyImage("resize", "down")).toEqual([100, 295, 300, 500]);
  expect(keyImage("resize", "up")).toEqual([100, 305, 300, 500]);
});

it("stops a keyed resize at ten points and at the page's view box", () => {
  const small = rects([[100, 300, 112, 312]]);
  expect(keyImage("resize", "left", small)).toEqual([100, 300, 110, 312]);
  expect(keyImage("resize", "up", small)).toEqual([100, 302, 112, 312]);
  // The view box is [10, 20, 622, 812].
  const edge = rects([[100, 22, 620, 500]]);
  expect(keyImage("resize", "right", edge)).toEqual([100, 22, 622, 500]);
  expect(keyImage("resize", "down", edge)).toEqual([100, 20, 620, 500]);
});

it("nudges an image by five points each way", () => {
  expect(keyImage("nudge", "left")).toEqual([95, 300, 295, 500]);
  expect(keyImage("nudge", "right")).toEqual([105, 300, 305, 500]);
  expect(keyImage("nudge", "up")).toEqual([100, 305, 300, 505]);
  expect(keyImage("nudge", "down")).toEqual([100, 295, 300, 495]);
});

it("refuses a nudge that would bring the mark within five points of the page's edge", () => {
  // Zotero moves a mark only while it stands a step and a padding, ten
  // points, inside the view box [10, 20, 622, 812] on the side it moves to.
  const nearLeft = rects([[19.9, 300, 100, 400]]);
  expect(keyImage("nudge", "left", nearLeft)).toBeNull();
  expect(keyImage("nudge", "left", rects([[20, 300, 100, 400]]))).toEqual([
    15, 300, 95, 400,
  ]);
  expect(
    keyImage("nudge", "right", rects([[100, 300, 612.1, 400]])),
  ).toBeNull();
  expect(keyImage("nudge", "down", rects([[100, 29.9, 200, 400]]))).toBeNull();
  expect(keyImage("nudge", "up", rects([[100, 300, 200, 802.1]]))).toBeNull();
  // The far side is no bar.
  expect(keyImage("nudge", "right", nearLeft)).toEqual([24.9, 300, 105, 400]);
});

it("scales ink by five points with its proportions held, about its top-left corner", () => {
  const key = (arrow: "left" | "right" | "up" | "down") => {
    const keyed = keyedPosition({
      confirmed: WIDE,
      edit: "resize",
      arrow,
      viewBox: VIEW_BOX,
      text: TEXT_CONTENT,
    })!.proposal as PdfInkPosition;
    const round = (value: number) => Math.round(value * 1e6) / 1e6;
    return {
      width: round(keyed.width),
      paths: keyed.paths.map((path) => path.map(round)),
    };
  };
  // The strokes span [100, 300, 300, 400], twice as wide as high. Right
  // makes them five points wider, 205 by 102.5, the top-left (100, 400) held.
  expect(key("right").paths).toEqual([
    [100, 297.5, 202.5, 348.75],
    [253.75, 379.5, 305, 400],
  ]);
  // Down makes them five points higher, so ten points wider: 210 by 105.
  expect(key("down").paths).toEqual([
    [100, 295, 205, 347.5],
    [257.5, 379, 310, 400],
  ]);
  // Left and Up shrink them the same way, the pen following the scale.
  expect(key("left").paths[0]).toEqual([100, 302.5, 197.5, 351.25]);
  expect(key("up").paths[0]).toEqual([100, 305, 195, 352.5]);
  expect(key("down").width).toBe(2.1);
});

it("nudges ink by five points, and refuses near the page's edge", () => {
  const nudged = keyedPosition({
    confirmed: WIDE,
    edit: "nudge",
    arrow: "right",
    viewBox: VIEW_BOX,
    text: TEXT_CONTENT,
  })!.proposal as PdfInkPosition;
  expect(nudged).toEqual(
    ink([
      [105, 300, 205, 350],
      [255, 380, 305, 400],
    ]),
  );
  const low = ink([[100, 25, 200, 125]]);
  expect(
    keyedPosition({
      confirmed: low,
      edit: "nudge",
      arrow: "down",
      viewBox: VIEW_BOX,
      text: TEXT_CONTENT,
    }),
  ).toBeNull();
});

it("keeps no image from a rectangle under ten points on either side", () => {
  expect(capturesImage([100, 300, 109.999, 500])).toBe(false);
  expect(capturesImage([100, 300, 300, 309.999])).toBe(false);
  expect(capturesImage([100, 300, 100, 300])).toBe(false);
  // Ten points exactly is big enough, as Zotero's own `>=` reads it.
  expect(capturesImage([100, 300, 110, 310])).toBe(true);
});

it("normalises the capture from whichever corner the drag started", () => {
  const box = [100, 300, 300, 500];
  // Down-right, up-right, down-left and up-left on screen, in PDF points.
  const drags = [
    [
      [100, 500],
      [300, 300],
    ],
    [
      [100, 300],
      [300, 500],
    ],
    [
      [300, 500],
      [100, 300],
    ],
    [
      [300, 300],
      [100, 500],
    ],
  ] as const;
  for (const [from, to] of drags) {
    expect(captureRect({ from, to, viewBox: VIEW_BOX })).toEqual(box);
  }
});

it("clamps the capture to the press page's view box, on every edge", () => {
  // The view box runs from (10, 20) to (622, 812).
  expect(
    captureRect({ from: [100, 300], to: [-50, -40], viewBox: VIEW_BOX }),
  ).toEqual([10, 20, 100, 300]);
  expect(
    captureRect({ from: [100, 300], to: [700, 900], viewBox: VIEW_BOX }),
  ).toEqual([100, 300, 622, 812]);
});

function textAt(rotation = 0, rect = [100, 700, 200, 720]): PdfTextPosition {
  return parseAnnotationPosition(
    {
      pageIndex: 1,
      rects: [rect],
      fontSize: 10,
      rotation,
    } as unknown as AnnotationPositionRaw,
    "application/pdf",
  ) as PdfTextPosition;
}

/** The text position a drag proposes, for a held grip moved by a delta. */
function dragText(
  grip: Grip,
  [dx, dy]: [number, number],
  confirmed = textAt(),
): PdfTextPosition {
  return roundAll(
    proposePosition({
      confirmed,
      grip,
      from: [150, 710],
      to: [150 + dx, 710 + dy],
      viewBox: VIEW_BOX,
      text: TEXT_CONTENT,
    }) as PdfTextPosition,
  );
}

function roundAll<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, item: unknown) =>
      typeof item === "number" ? Math.round(item * 1000) / 1000 : item,
    ),
  ) as T;
}

/** Each handle's centre by its grip, rounded. */
function handlesOf(record: Parameters<typeof handleLayout>[0]) {
  return Object.fromEntries(
    handleLayout(record).map(({ grip, at }) => [grip, roundAll(at)]),
  );
}

it("lays a free-text box's corner and side handles on its padded rect, with none on its top or foot", () => {
  expect(handlesOf({ type: "text", position: textAt() })).toEqual({
    tl: [95, 725],
    tr: [205, 725],
    br: [205, 695],
    bl: [95, 695],
    l: [95, 710],
    r: [205, 710],
  });
});

it("turns a free-text box's handles with the box, about its centre", () => {
  // A quarter turn counter-clockwise about (150, 710): the top-left corner,
  // (-55, 15) from the centre, goes to (-15, -55); the right side's middle,
  // (55, 0), goes to (0, 55).
  const handles = handlesOf({ type: "text", position: textAt(90) });
  expect(handles.tl).toEqual([135, 655]);
  expect(handles.r).toEqual([150, 765]);
  expect(handles.l).toEqual([150, 655]);
});

it("lays no handle on a note, which only moves", () => {
  const note = rects([[100, 300, 122, 322]]);
  expect(handleLayout({ type: "note", position: note })).toEqual([]);
});

it("takes a note's body by its stored rect, and a free-text box's by its padded rect as turned", () => {
  const note = rects([[100, 300, 122, 322]]);
  expect(bodyRect({ type: "note", position: note })).toEqual([
    100, 300, 122, 322,
  ]);
  expect(bodyRect({ type: "text", position: textAt() })).toEqual([
    95, 695, 205, 725,
  ]);
  // Turned a quarter, the 110 × 30 padded rect sweeps 30 × 110 about (150, 710).
  expect(roundAll(bodyRect({ type: "text", position: textAt(90) }))).toEqual([
    135, 655, 165, 765,
  ]);
});

it("moves a note by its body and keeps it on the page", () => {
  const note = rects([[100, 300, 122, 322]]);
  expect(drag("body", [12.5, -40], note)).toEqual([112.5, 260, 134.5, 282]);
  expect(drag("body", [-500, 0], note)).toEqual([10, 300, 32, 322]);
});

it("moves a free-text box by its body with its font size and turn kept", () => {
  expect(dragText("body", [12, -40], textAt(30))).toEqual({
    ...textAt(30),
    rects: [[112, 660, 212, 680]],
  });
});

it("stops a turned free-text box flush with the page by the box it sweeps out", () => {
  // Turned a quarter, the box sweeps [140, 660, 160, 760]; its left side
  // meets the view box's 10 after 130 points, while the stored rect runs
  // off the page.
  expect(dragText("body", [-500, 0], textAt(90)).rects).toEqual([
    [-30, 700, 70, 720],
  ]);
});

it("widens a free-text box from its right side, font kept, height fitted to its text", () => {
  // 130 points wide holds "hello" on one 12-point line, hung from the
  // top-left corner.
  expect(dragText("r", [30, 70])).toEqual({
    ...textAt(),
    rects: [[100, 708, 230, 720]],
  });
});

it("never narrows a free-text box below ten points, and fits its text into what is left", () => {
  // The left side stops 10 short of the right; 10 points hold two letters,
  // so "hello" takes three lines, 36 high, from the top-left corner.
  expect(dragText("l", [500, 0]).rects).toEqual([[190, 684, 200, 720]]);
});

it("moves a widened free-text box back five points inside the page", () => {
  // The left side reaches -400; one line of "hello" 600 wide reaches past
  // the inset at 15 by 415, and the box moves right by that.
  expect(dragText("l", [-500, 0]).rects).toEqual([[15, 708, 615, 720]]);
});

it("resizes a turned free-text box along its own width", () => {
  // Turned a quarter, the box's width runs up the page: 30 points up widens
  // it to 130. Its top-left corner, turned, stays at (140, 660): the 130 × 12
  // box's top-left, (-65, 6) from its centre, turns to (-6, -65).
  expect(dragText("r", [0, 30], textAt(90)).rects).toEqual([
    [81, 719, 211, 731],
  ]);
});

it("scales a free-text box from a corner with its proportions held, the opposite corner fixed", () => {
  // 150 wide at 5:1 is 30 high; the top-left corner (100, 720) stays. The
  // font scales by 1.5.
  expect(dragText("br", [50, -300])).toEqual({
    ...textAt(),
    fontSize: 15,
    rects: [[100, 690, 250, 720]],
  });
  // 120 wide is 24 high; the bottom-right corner (200, 700) stays.
  expect(dragText("tl", [-20, 0])).toEqual({
    ...textAt(),
    fontSize: 12,
    rects: [[80, 700, 200, 724]],
  });
});

it("scales a turned free-text box from a corner about the opposite corner as turned", () => {
  // Turned a quarter, the box's width runs up the page: 50 points up is 50
  // along its width, so 150 × 30 at 15 points. The top-left corner, opposite
  // the held one, stood at (140, 660): (-50, 10) from the centre (150, 710)
  // turns to (-10, -50). The new box's top-left, (-75, 15) from its centre,
  // turns to (-15, -75), so its centre is (155, 735).
  expect(dragText("br", [0, 50], textAt(90))).toEqual({
    ...textAt(90),
    fontSize: 15,
    rects: [[80, 720, 230, 750]],
  });
});

it("rounds a scaled font size down to the half point, as Zotero's drag does", () => {
  // 108 wide scales 10 points to 10.8, which rounds down to 10.5.
  expect(dragText("br", [8, 0]).fontSize).toBe(10.5);
  // The corner stops at ten points wide: 2 high, and the font 1 point.
  expect(dragText("br", [-500, 0])).toEqual({
    ...textAt(),
    fontSize: 1,
    rects: [[100, 718, 110, 720]],
  });
});

it("fits a free-text box to its line when a side drag ends, and leaves a corner's as it is", () => {
  const proposal = dragText("r", [30, 0]);
  // One 12-point line: the box takes "hello" and 5 points, 30 wide.
  expect(
    roundAll(
      releasedPosition({
        proposal,
        grip: "r",
        viewBox: VIEW_BOX,
        text: TEXT_CONTENT,
      }),
    ),
  ).toEqual({ ...textAt(), rects: [[100, 708, 130, 720]] });
  const scaled = dragText("br", [50, 0]);
  expect(
    releasedPosition({
      proposal: scaled,
      grip: "br",
      viewBox: VIEW_BOX,
      text: TEXT_CONTENT,
    }),
  ).toBe(scaled);
  expect(
    releasedPosition({
      proposal: IMAGE,
      grip: "r",
      viewBox: VIEW_BOX,
      text: TEXT_CONTENT,
    }),
  ).toBe(IMAGE);
});

it("reads the Geometry Edit a modified arrow asks of a note or a free-text box", () => {
  const plain = { shift: false, alt: false, mod: false };
  expect(keyEdit("note", { ...plain, alt: true })).toEqual({ kind: "nudge" });
  expect(keyEdit("text", { ...plain, alt: true })).toEqual({ kind: "nudge" });
  expect(keyEdit("text", { ...plain, shift: true })).toEqual({
    kind: "resize",
  });
});

/** What a key press proposes for the free-text box, or `null` if refused. */
function keyText(
  edit: "resize" | "nudge",
  arrow: "left" | "right" | "up" | "down",
) {
  const keyed = keyedPosition({
    confirmed: textAt(),
    edit,
    arrow,
    viewBox: VIEW_BOX,
    text: TEXT_CONTENT,
  });
  return keyed && { grip: keyed.grip, proposal: roundAll(keyed.proposal) };
}

it("resizes a free-text box by five points of its right side, fitted to its text, as Zotero's keys do", () => {
  expect(keyText("resize", "right")).toEqual({
    grip: "r",
    proposal: { ...textAt(), rects: [[100, 708, 205, 720]] },
  });
  expect(keyText("resize", "left")).toEqual({
    grip: "r",
    proposal: { ...textAt(), rects: [[100, 708, 195, 720]] },
  });
});

it("scales a free-text box by five points of width about its top-left corner, font rounded to the half point", () => {
  // 105 wide at 5:1 is 21 high, and 10.5 points of font.
  expect(keyText("resize", "down")).toEqual({
    grip: "br",
    proposal: { ...textAt(), fontSize: 10.5, rects: [[100, 699, 205, 720]] },
  });
  // 95 wide is 19 high; 9.5 points of font.
  expect(keyText("resize", "up")).toEqual({
    grip: "br",
    proposal: { ...textAt(), fontSize: 9.5, rects: [[100, 701, 195, 720]] },
  });
});

it("nudges a free-text box and a note by five points", () => {
  expect(keyText("nudge", "right")?.proposal).toEqual({
    ...textAt(),
    rects: [[105, 700, 205, 720]],
  });
  const note = rects([[100, 300, 122, 322]]);
  expect(keyImage("nudge", "up", note)).toEqual([100, 305, 122, 327]);
});
