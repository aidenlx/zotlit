import { describe, expect, it } from "vitest";

import { EmptyFilenameError, resolveFreeFlatName } from "./filename";

describe("resolveFreeFlatName", () => {
  it("keeps the name flat: a slash becomes an underscore", () => {
    expect(resolveFreeFlatName("2020/smith", () => false)).toBe("2020_smith");
  });

  it("throws EmptyFilenameError for an empty name", () => {
    expect(() => resolveFreeFlatName("...", () => false)).toThrow(
      EmptyFilenameError,
    );
  });
});
