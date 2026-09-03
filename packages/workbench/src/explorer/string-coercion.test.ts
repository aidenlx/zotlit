import { describe, expect, it } from "vitest";

import { coerceToString } from "./string-coercion";

describe("coerceToString", () => {
  it("uses JavaScript String coercion for objects", () => {
    const value = {
      [Symbol.toPrimitive]: () => "primitive",
      toString: () => "method",
    };

    expect(coerceToString(value)).toBe("primitive");
  });
});
