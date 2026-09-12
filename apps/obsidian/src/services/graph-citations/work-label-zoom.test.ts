import { describe, expect, it } from "vitest";

import { workLabelTitleAlpha } from "./work-label-zoom";

describe("Work Label title zoom", () => {
  it.each([
    [0, [0, 0, 0, 0.6, 0.6]],
    [1, [0, 0, 0, 0, 0.6]],
    [-1, [0, 0, 0.6, 0.6, 0.6]],
    [undefined, [0, 0, 0, 0.6, 0.6]],
    [Number.NaN, [0, 0, 0, 0.6, 0.6]],
  ] as const)("follows fade term %s", (fade, expected) => {
    expect(
      [0.25, 0.5, 1, 2, 4].map((scale) =>
        workLabelTitleAlpha(scale, fade, false),
      ),
    ).toEqual(expected);
  });

  it.each([0, 1, -1, undefined])(
    "shows a highlighted title at fade %s",
    (fade) => {
      expect(
        [0.25, 0.5, 1, 2, 4].map((scale) =>
          workLabelTitleAlpha(scale, fade, true),
        ),
      ).toEqual([0.6, 0.6, 0.6, 0.6, 0.6]);
    },
  );

  it("fades continuously within the octave", () => {
    expect(workLabelTitleAlpha(Math.SQRT2, 0, false)).toBeCloseTo(0.3);
    expect(workLabelTitleAlpha(1, -0.5, false)).toBe(0.3);
    expect(workLabelTitleAlpha(2, 0.5, false)).toBe(0.3);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "hides the title for invalid scale %s",
    (scale) => expect(workLabelTitleAlpha(scale, 0, false)).toBe(0),
  );
});
