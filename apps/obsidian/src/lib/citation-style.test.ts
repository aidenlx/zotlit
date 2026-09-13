import { expect, it } from "vitest";

import { citationStyleLabel } from "./citation-style";

it("names the built-in renderer default for both settings and picker values", () => {
  expect(citationStyleLabel(null)).toBe("Default (Chicago author-date)");
  expect(citationStyleLabel("")).toBe("Default (Chicago author-date)");
});

it("uses installed style titles and preserves unknown identifiers", () => {
  expect(
    citationStyleLabel("apa", [{ id: "apa", title: "APA Style 7th edition" }]),
  ).toBe("APA Style 7th edition");
  expect(citationStyleLabel("uninstalled-style")).toBe("uninstalled-style");
});
