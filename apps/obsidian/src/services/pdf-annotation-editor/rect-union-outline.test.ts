import { expect, it } from "vitest";

import { unionOutlinePath } from "./rect-union-outline";

it("draws nothing for an empty run", () => {
  expect(unionOutlinePath([], 2)).toBe("");
});

it("pads a single rect outward on every side", () => {
  const d = unionOutlinePath([[10, 10, 30, 20]], 2);

  expect(loopsOf(d)).toEqual([
    canonical([
      [8, 8],
      [32, 8],
      [32, 22],
      [8, 22],
    ]),
  ]);
});

it("hugs two rects sharing an edge as one silhouette, not two boxes", () => {
  // The shared edge at x=30 falls inside the union: no vertical edge is
  // traced there, and the outline is one rectangle 40 wide.
  const d = unionOutlinePath(
    [
      [10, 10, 30, 20],
      [30, 10, 50, 20],
    ],
    0,
  );

  expect(loopsOf(d)).toEqual([
    canonical([
      [10, 10],
      [50, 10],
      [50, 20],
      [10, 20],
    ]),
  ]);
});

it("follows a three-line staircase of uneven widths", () => {
  // Three highlight lines, each narrower than the last, stacked with no gap
  // between rows — the shape the drop-shadow treatment used to smear.
  const d = unionOutlinePath(
    [
      [0, 0, 100, 10],
      [0, 10, 80, 20],
      [0, 20, 50, 30],
    ],
    0,
  );

  expect(loopsOf(d)).toEqual([
    canonical([
      [0, 0],
      [100, 0],
      [100, 10],
      [80, 10],
      [80, 20],
      [50, 20],
      [50, 30],
      [0, 30],
    ]),
  ]);
});

it("bands edges that differ by less than a point's own noise floor", () => {
  // Two edges 0.004 page units apart are the same edge: the outline steps
  // from one to the other in one straight run, never a sliver jog between.
  const d = unionOutlinePath(
    [
      [0, 0, 100, 10],
      [0, 10, 100.004, 20],
    ],
    0,
  );

  expect(loopsOf(d)).toEqual([
    canonical([
      [0, 0],
      [100, 0],
      [100, 20],
      [0, 20],
    ]),
  ]);
});

it("traces the Fixture's own three-line underline as an eight-corner staircase", () => {
  // Annotation K3JRFLFQ on `rougier-2014.pdf`, its three stored rects
  // converted to page units at rotation 0 (`y = 792 - y`). The first two
  // lines' right edges sit 0.004 apart, which is conversion noise rather
  // than a step in the text.
  const d = unionOutlinePath(
    [
      [67.011, 171.23, 211.485, 179.362],
      [58.054, 181.888, 211.489, 190.02],
      [58.054, 192.546, 153.781, 200.679],
    ],
    1.5,
  );

  expect(loopsOf(d)).toEqual([
    canonical([
      [65.511, 169.73],
      [212.985, 169.73],
      [212.985, 191.52],
      [155.281, 191.52],
      [155.281, 202.179],
      [56.554, 202.179],
      [56.554, 180.388],
      [65.511, 180.388],
    ]),
  ]);
});

it("traces one loop per disjoint island", () => {
  const d = unionOutlinePath(
    [
      [0, 0, 10, 10],
      [20, 0, 30, 10],
    ],
    0,
  );

  expect(loopsOf(d)).toEqual(
    [
      canonical([
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ]),
      canonical([
        [20, 0],
        [30, 0],
        [30, 10],
        [20, 10],
      ]),
    ].sort(),
  );
});

it("keeps both rects outlined where two of them touch corner to corner", () => {
  // Four boundary edges meet at (10, 10), the one junction where a walk has a
  // real choice. Each rect stays fully drawn whichever way it goes, and the
  // junction itself is collinear on both axes, so no corner is emitted there.
  const d = unionOutlinePath(
    [
      [0, 0, 10, 10],
      [10, 10, 20, 20],
    ],
    0,
  );

  expect(segmentsOf(d)).toEqual(
    [
      // the first rect
      "0,0|10,0",
      "0,0|0,10",
      "0,10|20,10",
      // the second rect, sharing the junction's two collinear runs
      "10,0|10,20",
      "10,20|20,20",
      "20,10|20,20",
    ].sort(),
  );
});

it("outlines a run of rects that meet only at corners", () => {
  const d = unionOutlinePath(
    [
      [0, 0, 10, 10],
      [10, 10, 20, 20],
      [20, 20, 30, 30],
    ],
    0,
  );

  // Every rect contributes its own four sides, with each touching pair's two
  // collinear runs merged into one segment: 12 sides, 4 merges.
  expect(segmentsOf(d)).toHaveLength(8);
  expect(segmentsOf(d).filter((segment) => diagonal(segment))).toEqual([]);
});

/** Each drawn segment as `"x1,y1|x2,y2"`, endpoints ordered so the trace's own
 * direction does not matter — the set of ink a stroked path puts on the page. */
function segmentsOf(d: string): string[] {
  const segments: string[] = [];
  for (const piece of d
    .split(/(?=M )/)
    .filter((part) => part.trim().length > 0)) {
    const points = piece
      .replaceAll("Z", "")
      .trim()
      .split(/[ML]/)
      .filter((chunk) => chunk.trim().length > 0)
      .map(
        (chunk) => chunk.trim().split(/\s+/).map(Number) as [number, number],
      );
    const loop = [...points, points[0]!];
    for (let index = 0; index + 1 < loop.length; index++) {
      const [x1, y1] = loop[index]!;
      const [x2, y2] = loop[index + 1]!;
      const from = `${x1},${y1}`;
      const to = `${x2},${y2}`;
      segments.push(from < to ? `${from}|${to}` : `${to}|${from}`);
    }
  }
  return segments.sort();
}

/** A segment that is neither horizontal nor vertical — a walk that closed
 * across open space rather than along the boundary. */
function diagonal(segment: string): boolean {
  const [from, to] = segment.split("|");
  const [x1, y1] = from!.split(",");
  const [x2, y2] = to!.split(",");
  return x1 !== x2 && y1 !== y2;
}

/** Every closed subpath of `d`, each as its own list of `[x, y]` corners. */
function loopsOf(d: string): string[] {
  const subpaths = d.split(/(?=M )/).filter((piece) => piece.length > 0);
  return subpaths
    .map((piece) => {
      const numbers = piece
        .replaceAll("Z", "")
        .trim()
        .split(/[ML]/)
        .filter((chunk) => chunk.trim().length > 0)
        .map((chunk) => chunk.trim().split(/\s+/).map(Number));
      return canonical(numbers as [number, number][]);
    })
    .sort();
}

/**
 * A loop's corners, normalised so the trace's arbitrary starting point and
 * winding direction don't matter: rotate to start at the lexicographically
 * smallest corner, try both directions, and keep whichever reads smaller.
 */
function canonical(points: readonly (readonly [number, number])[]): string {
  const rotations = (ordered: readonly (readonly [number, number])[]) =>
    ordered.map((_, offset) =>
      [...ordered.slice(offset), ...ordered.slice(0, offset)]
        .map(([x, y]) => `${x},${y}`)
        .join(" "),
    );
  const forward = rotations(points).sort()[0]!;
  const backward = rotations([...points].reverse()).sort()[0]!;
  return forward < backward ? forward : backward;
}
