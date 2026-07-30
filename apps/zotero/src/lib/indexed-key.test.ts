import { describe, expect, it } from "vitest";

import { formatObjectKeys } from "./indexed-key.js";

describe("formatObjectKeys", () => {
  it("formats personal and group-library identities in row order", () => {
    expect(
      formatObjectKeys([
        { key: "ABCD2345", groupID: null },
        { key: "WXYZ6789", groupID: 42 },
        { key: "EFGH3456", groupID: null },
      ]),
    ).toBe("ABCD2345\nWXYZ6789g42\nEFGH3456");
  });

  it("formats a single identity as a bare key", () => {
    expect(formatObjectKeys([{ key: "ABCD2345", groupID: 42 }])).toBe(
      "ABCD2345g42",
    );
  });
});
