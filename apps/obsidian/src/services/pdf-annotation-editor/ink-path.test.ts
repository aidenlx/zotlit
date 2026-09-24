import { describe, expect, it } from "vitest";

import {
  MAX_POSITION_LENGTH,
  roundCoordinate,
  writePosition,
} from "@/services/annotation-repository/write";

import {
  clampToViewBox,
  inkReach,
  keepsSample,
  MAX_POINTS_PER_SAMPLE,
  nearStroke,
  smoothPath,
  StrokeSamples,
} from "./ink-path";

/**
 * Expected vectors are the output of Zotero's own `smoothPath` for each input,
 * computed once by running the file under Node and inlined here.
 *
 * @see https://github.com/zotero/reader/blob/df215c60334d2d0c7b1fbc9f3959b66afc1ced83/src/pdf/lib/path.js#L1-L49
 */
describe("smoothPath", () => {
  it("keeps a single point as it is, which Zotero draws as a dot", () => {
    expect(smoothPath([5, 5])).toEqual([5, 5]);
  });

  it("folds two points under one point apart into the first", () => {
    expect(smoothPath([0, 0, 0.5, 0])).toEqual([0, 0]);
  });

  it("drops the last point when it lands under one point from the last kept one", () => {
    // Zotero's close-point filter runs over the last point too, so the end of
    // a straight stroke is lost: (8, 0) is 0.5 past (7.5, 0).
    expect(smoothPath([0, 0, 8, 0])).toEqual([
      0, 0, 1.5, 0, 3, 0, 5, 0, 6.5, 0, 7.5, 0,
    ]);
    expect(smoothPath([0, 0, 4, 8, 8, 0, 12, 8])).toEqual([
      0, 0, 0.75, 1.5, 1.5, 3, 2.5, 5, 3.5, 6, 4.5, 6, 5.5, 5, 6.5, 3, 7.5, 2,
      8.5, 2, 9.5, 3, 10.5, 5, 11.25, 6.5, 11.75, 7.5,
    ]);
  });

  it("cuts a corner twice and keeps both endpoints when they stand clear", () => {
    expect(smoothPath([0, 0, 16, 0, 16, 16])).toEqual([
      0, 0, 1, 0, 3, 0, 6, 0, 10, 0, 13, 1, 15, 3, 16, 6, 16, 10, 16, 13, 16,
      15, 16, 16,
    ]);
  });
});

describe("keepsSample", () => {
  it("keeps the first sample of a stroke", () => {
    expect(keepsSample(undefined, [3, 4])).toBe(true);
  });

  it("drops a sample under one point from the last kept one", () => {
    expect(keepsSample([0, 0], [0.6, 0.79])).toBe(false);
  });

  it("keeps a sample one point or more away", () => {
    expect(keepsSample([0, 0], [0.6, 0.8])).toBe(true);
    expect(keepsSample([0, 0], [0, -2])).toBe(true);
  });
});

describe("clampToViewBox", () => {
  const box = [10, 20, 622, 812] as const;

  it("keeps a point inside the box", () => {
    expect(clampToViewBox([300, 400], box)).toEqual([300, 400]);
  });

  it("pulls a point past each edge back onto it", () => {
    expect(clampToViewBox([5, 400], box)).toEqual([10, 400]);
    expect(clampToViewBox([700, 400], box)).toEqual([622, 400]);
    expect(clampToViewBox([300, 0], box)).toEqual([300, 20]);
    expect(clampToViewBox([300, 900], box)).toEqual([300, 812]);
    expect(clampToViewBox([-1, 1000], box)).toEqual([10, 812]);
  });
});

describe("nearStroke", () => {
  /** One segment from (0, 0) to (10, 0), taken within a reach of 5. */
  const near = (point: readonly [number, number]) =>
    nearStroke(
      point,
      [
        [
          [0, 0],
          [10, 0],
        ],
      ],
      5,
    );

  it("measures a point beside a segment square to it", () => {
    expect(near([4, 4.9])).toBe(true);
    expect(near([4, -4.9])).toBe(true);
    expect(near([4, 5.1])).toBe(false);
  });

  it("measures a point beyond an end to that end", () => {
    // (13, 3.9) is 4.93 from (10, 0); (13, 4) is exactly 5.
    expect(near([13, 3.9])).toBe(true);
    expect(near([13, 4])).toBe(false);
    expect(near([-3, -4])).toBe(false);
  });

  it("takes a point on the segment", () => {
    expect(near([7, 0])).toBe(true);
    expect(near([10, 0])).toBe(true);
  });

  it("takes a one-point stroke within the reach of that point", () => {
    expect(nearStroke([3, 3.9], [[[0, 0]]], 5)).toBe(true);
    expect(nearStroke([3, 4], [[[0, 0]]], 5)).toBe(false);
  });

  it("answers for any stroke of the mark", () => {
    const paths = [
      [
        [0, 0],
        [10, 0],
      ],
      [
        [0, 50],
        [10, 50],
      ],
    ] as const;
    expect(nearStroke([5, 48], paths, 5)).toBe(true);
    expect(nearStroke([5, 25], paths, 5)).toBe(false);
  });
});

describe("inkReach", () => {
  it("is the pen's full width", () => {
    expect(inkReach(30)).toBe(30);
  });

  it("never falls under Zotero's seven-point floor", () => {
    expect(inkReach(2)).toBe(7);
  });
});

describe("StrokeSamples", () => {
  const FRAME = { pageIndex: 3, width: 2 };

  /**
   * A zig-zag scribble down a letter page, row after row: every sample three
   * points from the last, so each is kept, and the corners keep Zotero's
   * smoothing from folding the points together.
   */
  const scribble = (count: number) =>
    Array.from({ length: count }, (_, index): [number, number] => {
      const row = Math.floor(index / 150);
      const column = index % 150;
      return [
        100.123 + 3 * (row % 2 === 0 ? column : 149 - column),
        700.456 - 12 * row - (index % 2) * 5,
      ];
    });

  /** Whether these samples, sent to Zotero as one stroke, fit the ceiling. */
  const fits = (samples: readonly [number, number][]) =>
    writePosition({ ...FRAME, paths: [smoothPath(samples.flat())] }).length <=
    MAX_POSITION_LENGTH;

  it("parts a stroke at the sample that would carry it past the ceiling", () => {
    const samples = scribble(4000);
    const stroke = new StrokeSamples(FRAME);

    const parts = samples.flatMap((sample, index) => {
      const finished = stroke.take(sample);
      return finished ? [{ index, finished }] : [];
    });

    // About two thousand of these samples fill one Annotation.
    expect(parts).toHaveLength(1);
    const { index, finished } = parts[0]!;
    // The finished part is every sample before this one, and it fits…
    expect(finished).toEqual(
      smoothPath(samples.slice(0, index).flat()).map(roundCoordinate),
    );
    expect(fits(samples.slice(0, index))).toBe(true);
    // …where this sample would not have.
    expect(fits(samples.slice(0, index + 1))).toBe(false);
    // The next part begins where the finished part ends, so the two meet,
    // and goes on from this sample.
    const seam = finished.slice(-2) as [number, number];
    const next = stroke.finish();
    expect(next.slice(0, 2)).toEqual(seam);
    const rest = new StrokeSamples(FRAME);
    for (const sample of [seam, ...samples.slice(index)]) rest.take(sample);
    expect(next).toEqual(rest.finish());
  });

  it("adds at most MAX_POINTS_PER_SAMPLE smoothed points for one more sample", () => {
    // A fixed linear congruential sequence: steps from under one point to
    // twenty, in every direction, so the filter both keeps and drops.
    let seed = 1_234_567;
    const random = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed / 2_147_483_648;
    };
    for (let run = 0; run < 50; run++) {
      const raw = [300, 400];
      let before = smoothPath(raw).length / 2;
      for (let step = 0; step < 200; step++) {
        const reach = random() < 0.5 ? 1.5 * random() : 20 * random();
        const turn = 2 * Math.PI * random();
        raw.push(
          raw.at(-2)! + reach * Math.cos(turn),
          raw.at(-1)! + reach * Math.sin(turn),
        );
        const after = smoothPath(raw).length / 2;
        expect(after - before).toBeLessThanOrEqual(MAX_POINTS_PER_SAMPLE);
        before = after;
      }
    }
  });

  it("keeps a stroke within the ceiling whole", () => {
    const samples = scribble(600);
    const stroke = new StrokeSamples(FRAME);

    expect(samples.map((sample) => stroke.take(sample))).toEqual(
      samples.map(() => null),
    );
    expect(stroke.finish()).toEqual(
      smoothPath(samples.flat()).map(roundCoordinate),
    );
  });

  it("drops a sample under one point from the last kept one", () => {
    const stroke = new StrokeSamples(FRAME);

    stroke.take([10, 10]);
    stroke.take([10.5, 10]);

    expect(stroke.finish()).toEqual([10, 10]);
  });
});
