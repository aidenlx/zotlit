import { describe, expect, it } from "vitest";

import { DIAGNOSTIC_HINTS } from "./envelope";

describe("DIAGNOSTIC_HINTS", () => {
  it.each(Object.entries(DIAGNOSTIC_HINTS))(
    "%s is non-empty printable ASCII ending with a period",
    (_code, hint) => {
      expect(hint).toMatch(/^[\x20-\x7E]+$/);
      expect(hint.endsWith(".")).toBe(true);
    },
  );
});
