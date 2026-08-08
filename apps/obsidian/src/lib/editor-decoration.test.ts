import { describe, expect, it } from "vitest";

import { overlapsSelection } from "./editor-decoration";

describe("overlapsSelection", () => {
  const range = { from: 4, to: 4 };

  it("counts a cursor at either end of the span, as Obsidian does", () => {
    expect(overlapsSelection([range], 4, 10)).toBe(true);
    expect(overlapsSelection([{ from: 10, to: 10 }], 4, 10)).toBe(true);
  });

  it("counts a selection that crosses the span", () => {
    expect(overlapsSelection([{ from: 2, to: 20 }], 4, 10)).toBe(true);
  });

  it("leaves a span no range touches alone", () => {
    expect(overlapsSelection([range], 6, 10)).toBe(false);
    expect(overlapsSelection([{ from: 11, to: 14 }], 4, 10)).toBe(false);
  });

  it("touches nothing without a range, which is how a blurred editor reads", () => {
    expect(overlapsSelection([], 4, 10)).toBe(false);
  });
});
