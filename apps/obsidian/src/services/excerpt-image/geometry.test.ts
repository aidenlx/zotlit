import { describe, expect, it, vi } from "vitest";

import type { AnnotationRecord } from "@/services/annotation-repository/service";

import {
  clipExcerptBounds,
  excerptBounds,
  paintInk,
  viewportBounds,
} from "./geometry";
import type { ExcerptViewport } from "./geometry";

const ink: AnnotationRecord = {
  key: "INK",
  parentKey: "PDF",
  type: "ink",
  color: "#ff0000",
  comment: null,
  text: null,
  pageLabel: "1",
  sortIndex: "00000|000000|00000",
  tags: [],
  version: null,
  lock: null,
  position: {
    kind: "pdf-ink",
    pageIndex: 0,
    width: 4,
    paths: [
      [40, 50, 80, 90],
      [30, 70, 90, 60],
    ],
  },
};

describe("ink excerpt geometry", () => {
  it("clips padding at a nonzero page crop box and rejects an off-page stroke", () => {
    expect(clipExcerptBounds([-15, 8, 250, 310], [20, 30, 220, 330])).toEqual([
      20, 30, 220, 310,
    ]);
    expect(() => clipExcerptBounds([1, 2, 10, 15], [20, 30, 220, 330])).toThrow(
      "outside PDF page",
    );
  });
  it("includes every path, half-width spill, and ten PDF units of padding", () => {
    expect(excerptBounds(ink)).toEqual([18, 38, 102, 102]);
  });
  it("gives a single point Zotero's sixty-unit minimum crop", () => {
    expect(
      excerptBounds({
        ...ink,
        position: {
          kind: "pdf-ink",
          pageIndex: 0,
          width: 2,
          paths: [[50, 60]],
        },
      }),
    ).toEqual([20, 30, 80, 90]);
  });
  it.each(
    [[], [[1]], [[1, Number.NaN]], [[1, 2, 3]]].map((paths) => ({ paths })),
  )("rejects unusable paths %j", ({ paths }) => {
    expect(() =>
      excerptBounds({
        ...ink,
        position: { kind: "pdf-ink", pageIndex: 0, width: 2, paths },
      }),
    ).toThrow();
  });
  // Worked 200x300 page transforms: x'=x,y'=300-y; x'=y,y'=x;
  // x'=200-x,y'=y; x'=300-y,y'=200-x. No production transform is reused.
  it.each([
    [0, (x: number, y: number) => [x, 300 - y], [18, 198, 84, 64]],
    [90, (x: number, y: number) => [y, x], [38, 18, 64, 84]],
    [180, (x: number, y: number) => [200 - x, y], [98, 38, 84, 64]],
    [270, (x: number, y: number) => [300 - y, 200 - x], [198, 98, 64, 84]],
  ] as const)(
    "preserves crop at %i degrees",
    (_rotation, transform, expected) => {
      const viewport: ExcerptViewport = {
        convertToViewportPoint: (x, y) => transform(x, y) as [number, number],
      };
      expect(viewportBounds([18, 38, 102, 102], viewport)).toEqual(expected);
    },
  );
  it("paints rotated paths with saved color and physical width, including point strokes", () => {
    const context = {
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
    };
    paintInk({
      annotation: {
        ...ink,
        position: {
          kind: "pdf-ink",
          pageIndex: 0,
          width: 4,
          paths: [
            [10, 20, 30, 40],
            [50, 60],
            [70, 80, 70, 80],
          ],
        },
      },
      viewport: { convertToViewportPoint: (x, y) => [2 * y - 10, 2 * x - 20] },
      context: context as unknown as CanvasRenderingContext2D,
    });
    expect(context).toMatchObject({
      strokeStyle: "#ff0000",
      fillStyle: "#ff0000",
      lineWidth: 8,
      lineCap: "round",
      lineJoin: "round",
    });
    expect(context.moveTo.mock.calls).toEqual([
      [30, 0],
      [110, 80],
      [150, 120],
    ]);
    expect(context.lineTo.mock.calls).toEqual([
      [70, 40],
      [150, 120],
    ]);
    expect(context.stroke).toHaveBeenCalledTimes(1);
    expect(context.arc.mock.calls).toEqual([
      [110, 80, 4, 0, 2 * Math.PI],
      [150, 120, 4, 0, 2 * Math.PI],
    ]);
    expect(context.fill).toHaveBeenCalledTimes(2);
  });
});
