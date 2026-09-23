import { expect, it } from "vitest";

import { parseAnnotationPosition } from "@zotlit/db";
import type { AnnotationPositionRaw, PdfRectsPosition } from "@zotlit/db";

import {
  gripAt,
  gripCursor,
  handleLayout,
  proposePosition,
  sameGeometry,
} from "./geometry-edit";
import type { Grip } from "./geometry-edit";

/** A US Letter page seen from a non-zero origin, as a PDF may describe it. */
const VIEW_BOX = [10, 20, 622, 812] as const;

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
  });
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
  expect(
    handleLayout({
      type: "ink",
      position: parseAnnotationPosition(
        {
          pageIndex: 1,
          width: 2,
          paths: [[0, 0, 5, 5]],
        } as unknown as AnnotationPositionRaw,
        "application/pdf",
      ),
    }),
  ).toEqual([]);
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
