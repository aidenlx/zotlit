import { describe, expect, it } from "vitest";

import { isPageNumber } from "./zt-page-label";

describe("isPageNumber", () => {
  it.each([
    "1",
    "57",
    "0012",
    "xiv",
    "XIV",
    "iv",
    "mcmxc",
    " 12 ",
    "12-15",
    "12–15",
    "iii - v",
  ])("takes %j as a page number", (label) =>
    expect(isPageNumber(label)).toBe(true),
  );

  it.each([
    "",
    "Chapter 1",
    "Sakima's Song",
    "A12",
    "12a",
    "Cover",
    "iiii",
    "vv",
    "12-",
  ])("takes %j as a named label", (label) =>
    expect(isPageNumber(label)).toBe(false),
  );
});
