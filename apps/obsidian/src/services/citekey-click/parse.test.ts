import { describe, expect, it } from "vitest";

import { citationAtOffset } from "./parse";

describe("citationAtOffset", () => {
  it("resolves a Pandoc citation under the cursor", () => {
    const line = "see [@doe2024alpha] for details";
    // offset on the `d` of the key
    expect(citationAtOffset(line, 7)).toEqual({
      citekey: "doe2024alpha",
      start: 5,
      end: 18,
    });
  });

  it("matches a click on the leading @ and just past the key", () => {
    const line = "[@key]";
    expect(citationAtOffset(line, 1)?.citekey).toBe("key");
    expect(citationAtOffset(line, 5)?.citekey).toBe("key");
  });

  it("stops the key at a locator separator", () => {
    const line = "[@smith2020, p. 3]";
    const token = citationAtOffset(line, 3);
    expect(token?.citekey).toBe("smith2020");
    expect(line.slice(token!.start, token!.end)).toBe("@smith2020");
  });

  it("resolves each key in a multi-citation group", () => {
    const line = "[@a2020; @b2021]";
    expect(citationAtOffset(line, 2)?.citekey).toBe("a2020");
    expect(citationAtOffset(line, 11)?.citekey).toBe("b2021");
  });

  it("matches a suppress-author citation (`-@key`)", () => {
    const line = "[-@doe2024]";
    expect(citationAtOffset(line, 4)?.citekey).toBe("doe2024");
  });

  it("matches a bare citation key", () => {
    expect(citationAtOffset("@doe2024 said", 3)?.citekey).toBe("doe2024");
  });

  it("ignores an @ preceded by a word character (emails, handles)", () => {
    expect(citationAtOffset("mail me@example.com now", 9)).toBeNull();
  });

  it("returns null when the offset is outside any citation", () => {
    const line = "see [@doe2024] later";
    expect(citationAtOffset(line, 0)).toBeNull();
    expect(citationAtOffset(line, 18)).toBeNull();
  });
});
