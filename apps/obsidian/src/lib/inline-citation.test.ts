import { describe, expect, it } from "vitest";

import { inlineCitation } from "./inline-citation";

describe("inlineCitation", () => {
  it("trims leading and trailing whitespace, including the template file's trailing newline", () => {
    expect(inlineCitation("[@smith2024]\n")).toBe("[@smith2024]");
    expect(inlineCitation("  @smith2024  ")).toBe("@smith2024");
  });

  it("collapses whitespace runs containing a line break to a single space", () => {
    expect(inlineCitation("[@smith2024,\n  p. 62]")).toBe(
      "[@smith2024, p. 62]",
    );
    expect(inlineCitation("[@a2020;\r\n@b2021]")).toBe("[@a2020; @b2021]");
  });

  it("keeps runs of plain spaces inside the output as authored", () => {
    expect(inlineCitation("[@smith2024,  p. 62]")).toBe("[@smith2024,  p. 62]");
  });
});
