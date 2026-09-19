// Traces the outline of a union of axis-aligned rectangles as a single SVG
// path `d` string — pure logic, so this is the unit-test subject per
// apps/obsidian/policies/ui-testing.md, and render.ts only calls it.

/** A box in page units, `[left, top, right, bottom]` — the same shape a mark's
 * own rects take in render.ts, kept local so this module carries no
 * dependency on the renderer. */
export type OutlineRect = readonly [number, number, number, number];

type Point = readonly [number, number];
type Interval = readonly [number, number];
type Edge = readonly [Point, Point];

/**
 * How far apart two coordinates may sit and still count as the same edge, in
 * page units — hundredths of a PDF point. A point is 1/72 inch, so a
 * hundredth of one sits under a device pixel on any display at any zoom step.
 * Two edges that close apart are the same edge, measured twice through the
 * viewport conversion — the Fixture's own three-line underline stores two of
 * them 0.004 apart — and banding them keeps the outline from stepping by a
 * sliver where the text runs straight.
 */
const TOLERANCE = 0.01;

/** Decimals kept on an emitted coordinate — the precision Zotero itself
 * stores a rect in, which is one step finer than {@link TOLERANCE} and so
 * never merges two edges the banding kept apart. */
const PRECISION = 3;

/**
 * Traces the merged silhouette of `rects`, each padded outward by `padding`
 * on every side, into the SVG path `d` string for the union's boundary — one
 * closed subpath per disjoint island, following the actual staircase shape
 * rather than a bounding box.
 *
 * Coordinates are banded to {@link TOLERANCE} first, so the whole sweep can
 * then compare them exactly: the input is viewport-converted floats, and two
 * edges a hundredth of a point apart are the same edge.
 *
 * Rectangles are axis-aligned, so the union's boundary is exact and
 * deterministic: rows are swept from the padded rects' distinct y-coordinates,
 * each row's covered x-intervals are merged, and a boundary edge is wherever
 * a row's coverage differs from the row above it (horizontal) or from its own
 * interval neighbours within the row (vertical). Those edges are then walked
 * into closed loops by taking any unused edge at each vertex.
 *
 * Empty input answers with the empty string, which is the caller's cue to
 * draw nothing.
 */
export function unionOutlinePath(
  rects: readonly OutlineRect[],
  padding: number,
): string {
  if (rects.length === 0) return "";

  const spread = rects.map(
    ([left, top, right, bottom]): OutlineRect => [
      left - padding,
      top - padding,
      right + padding,
      bottom + padding,
    ],
  );
  const xBand = bandAxis(spread.flatMap(([left, , right]) => [left, right]));
  const yBand = bandAxis(spread.flatMap(([, top, , bottom]) => [top, bottom]));
  const padded = spread.map(
    ([left, top, right, bottom]): OutlineRect => [
      xBand.get(left)!,
      yBand.get(top)!,
      xBand.get(right)!,
      yBand.get(bottom)!,
    ],
  );

  const ys = distinctSorted(
    padded.flatMap(([, top, , bottom]) => [top, bottom]),
  );
  const rowIntervals: Interval[][] = [];
  for (let index = 0; index + 1 < ys.length; index++) {
    const top = ys[index]!;
    const bottom = ys[index + 1]!;
    rowIntervals.push(
      mergeIntervals(
        padded
          .filter(([, rTop, , rBottom]) => rTop <= top && rBottom >= bottom)
          .map(([left, , right]): Interval => [left, right]),
      ),
    );
  }

  const edges: Edge[] = [];
  // Horizontal edges: wherever a row's coverage differs from the row above —
  // nothing, at the very top of the whole silhouette, and nothing below the
  // very bottom.
  for (let index = 0; index < ys.length; index++) {
    const above = rowIntervals[index - 1] ?? [];
    const below = rowIntervals[index] ?? [];
    const y = ys[index]!;
    for (const [left, right] of xorIntervals(above, below)) {
      edges.push([
        [left, y],
        [right, y],
      ]);
    }
  }
  // Vertical edges: the left and right end of each row's own merged
  // intervals, since a row is defined as a maximal strip of constant
  // coverage and so every vertical edge inside it spans its full height.
  for (let index = 0; index < rowIntervals.length; index++) {
    const top = ys[index]!;
    const bottom = ys[index + 1]!;
    for (const [left, right] of rowIntervals[index]!) {
      edges.push([
        [left, top],
        [left, bottom],
      ]);
      edges.push([
        [right, top],
        [right, bottom],
      ]);
    }
  }

  return traceLoops(edges)
    .map(pathOf)
    .filter((d) => d.length > 0)
    .join(" ");
}

/**
 * Each value against the band it joins: the values are swept in order and a
 * new band opens only where the gap from the open band's own coordinate
 * exceeds {@link TOLERANCE}, so every edge within a band answers with one
 * shared coordinate and the sweep can compare coordinates exactly.
 */
function bandAxis(values: readonly number[]): Map<number, number> {
  const bands = new Map<number, number>();
  let band: number | undefined;
  for (const value of distinctSorted(values)) {
    if (band === undefined || value - band > TOLERANCE) band = value;
    bands.set(value, band);
  }
  return bands;
}

function distinctSorted(values: readonly number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

/** Sorted, disjoint, non-touching intervals: touching ones merge into one. */
function mergeIntervals(intervals: readonly Interval[]): Interval[] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const merged: Interval[] = [sorted[0]!];
  for (const [left, right] of sorted.slice(1)) {
    const last = merged[merged.length - 1]!;
    if (left <= last[1])
      merged[merged.length - 1] = [last[0], Math.max(last[1], right)];
    else merged.push([left, right]);
  }
  return merged;
}

/**
 * The x-ranges covered by exactly one of `a` and `b` — each already sorted
 * and disjoint — which is where a horizontal boundary edge sits between two
 * rows.
 */
function xorIntervals(
  a: readonly Interval[],
  b: readonly Interval[],
): Interval[] {
  const points = distinctSorted(
    [...a, ...b].flatMap(([left, right]) => [left, right]),
  );
  const result: Interval[] = [];
  let start: number | null = null;
  for (let index = 0; index + 1 < points.length; index++) {
    const left = points[index]!;
    const right = points[index + 1]!;
    const middle = (left + right) / 2;
    const inA = a.some(
      ([aLeft, aRight]) => aLeft <= middle && middle <= aRight,
    );
    const inB = b.some(
      ([bLeft, bRight]) => bLeft <= middle && middle <= bRight,
    );
    if (inA !== inB) {
      start ??= left;
    } else if (start !== null) {
      result.push([start, left]);
      start = null;
    }
  }
  if (start !== null) result.push([start, points[points.length - 1]!]);
  return result;
}

function key([x, y]: Point): string {
  return `${x},${y}`;
}

interface Arc {
  to: Point;
  edgeIndex: number;
}

interface Vertex {
  point: Point;
  arcs: Arc[];
}

/** Every closed loop the boundary `edges` trace, in page-unit points. */
function traceLoops(edges: readonly Edge[]): Point[][] {
  const vertices = new Map<string, Vertex>();
  const vertexAt = (point: Point): Vertex => {
    const found = vertices.get(key(point));
    if (found) return found;
    const created: Vertex = { point, arcs: [] };
    vertices.set(key(point), created);
    return created;
  };
  edges.forEach(([a, b], edgeIndex) => {
    vertexAt(a).arcs.push({ to: b, edgeIndex });
    vertexAt(b).arcs.push({ to: a, edgeIndex });
  });

  const trace: Trace = { vertices, used: edges.map(() => false) };
  const loops: Point[][] = [];
  for (const vertex of vertices.values()) {
    for (const arc of vertex.arcs) {
      if (trace.used[arc.edgeIndex]) continue;
      loops.push(simplify(walkLoop(trace, vertex.point, arc)));
    }
  }
  return loops;
}

/** The vertex adjacency and the edges already spent — threaded through the
 * walk as one bundle, since every step of it needs both. */
interface Trace {
  vertices: ReadonlyMap<string, Vertex>;
  used: boolean[];
}

function walkLoop(trace: Trace, start: Point, firstArc: Arc): Point[] {
  const loop: Point[] = [start];
  let current = start;
  let arc = firstArc;
  for (;;) {
    trace.used[arc.edgeIndex] = true;
    current = arc.to;
    loop.push(current);
    if (key(current) === key(start)) break;
    arc = nextArc(trace, current);
  }
  return loop;
}

/**
 * Any edge at the vertex the walk has yet to spend.
 *
 * A vertex of a rectilinear boundary always carries an even number of edges,
 * so a walk that leaves on an unused one always finds a way back and never
 * strands itself — the choice between them cannot open a gap. Where four
 * edges meet, at two rects touching corner to corner, the choice decides only
 * which loop each pair joins, and the outline is stroked rather than filled,
 * so every segment reaches the screen either way.
 */
function nextArc(trace: Trace, at: Point): Arc {
  const vertex = trace.vertices.get(key(at))!;
  return vertex.arcs.find((arc) => !trace.used[arc.edgeIndex])!;
}

/** Drops the closing duplicate and every point that only continues a
 * straight run, so the path carries one command per actual corner. */
function simplify(loop: readonly Point[]): Point[] {
  const points = loop.slice(0, -1);
  const result: Point[] = [];
  for (const point of points) {
    while (
      result.length >= 2 &&
      collinear(result[result.length - 2]!, result[result.length - 1]!, point)
    ) {
      result.pop();
    }
    result.push(point);
  }
  // The wrap-around joint: the last point standing is redundant exactly when
  // it only continues the run from its predecessor into the first point.
  while (
    result.length >= 3 &&
    collinear(
      result[result.length - 2]!,
      result[result.length - 1]!,
      result[0]!,
    )
  ) {
    result.pop();
  }
  return result;
}

function collinear([x1, y1]: Point, [x2, y2]: Point, [x3, y3]: Point): boolean {
  return (x1 === x2 && x2 === x3) || (y1 === y2 && y2 === y3);
}

function pathOf(loop: readonly Point[]): string {
  if (loop.length === 0) return "";
  const [first, ...rest] = loop;
  const move = `M ${round(first![0])} ${round(first![1])}`;
  const lines = rest.map(([x, y]) => `L ${round(x)} ${round(y)}`).join(" ");
  return `${move} ${lines} Z`;
}

/** A coordinate at {@link PRECISION}, so the sum of a rect and its padding
 * reaches the `d` string as a page coordinate rather than a 17-digit float. */
function round(value: number): number {
  const scale = 10 ** PRECISION;
  return Math.round(value * scale) / scale;
}
