import { describe, expect, it } from "vitest";

import { openOnLoad } from "./lesson-state";

describe("openOnLoad", () => {
  it("keeps every row closed for a reader who has not started", () => {
    expect(openOnLoad("", [], 7)).toBeNull();
  });

  it("opens the first step not ticked for a reader who began", () => {
    expect(openOnLoad("", [1, 2, 4], 7)).toBe(3);
  });

  it("opens the step a hash names, ticks or not", () => {
    expect(openOnLoad("#5", [], 7)).toBe(5);
  });

  it("keeps every row closed once every step is ticked", () => {
    expect(openOnLoad("", [1, 2, 3], 3)).toBeNull();
  });

  it("keeps every row closed for the end's hash", () => {
    expect(openOnLoad("#done", [1], 3)).toBeNull();
  });
});
