import { describe, expect, it } from "vitest";

import { frontmatterInstant } from "./frontmatter-date";

describe("frontmatterInstant", () => {
  it("reads a YAML timestamp Date as the same instant", () => {
    expect(
      frontmatterInstant(new Date("2024-01-01T10:00:00.250Z"))?.toString(),
    ).toBe("2024-01-01T10:00:00.25Z");
  });

  it("passes over a value that is not a Date", () => {
    expect(frontmatterInstant("2024-01-01T10:00:00Z")).toBeUndefined();
  });
});
