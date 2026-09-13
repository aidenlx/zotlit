import { describe, expect, it } from "vitest";

import {
  normalizePartialName,
  partialFilename,
  partialNameRefusal,
} from "./defaults";

describe("the Shared Partial name rule", () => {
  it("folds what the reader types into the name the file carries", () => {
    expect(normalizePartialName("  Venue line  ")).toBe("venue-line");
    expect(partialFilename(normalizePartialName("Venue line"))).toBe(
      "zotlit-partial.venue-line.md",
    );
    expect(normalizePartialName("Authors and\teditors")).toBe(
      "authors-and-editors",
    );
    expect(normalizePartialName("venue-line-2")).toBe("venue-line-2");
  });

  it("accepts letters, digits, and hyphens and refuses everything else", () => {
    expect(partialNameRefusal("venue-line", [])).toBeNull();
    expect(partialNameRefusal("v2", [])).toBeNull();
    expect(partialNameRefusal("", [])).toBe("empty");
    expect(partialNameRefusal("venue.line", [])).toBe("characters");
    expect(partialNameRefusal("venue_line", [])).toBe("characters");
    expect(partialNameRefusal("引用", [])).toBe("characters");
  });

  it("refuses a name another ZotLit template already answers to", () => {
    expect(partialNameRefusal("annotation", [])).toBe("reserved");
    expect(partialNameRefusal("citation", [])).toBe("reserved");
    expect(partialNameRefusal("note", [])).toBe("reserved");
    expect(partialNameRefusal("filename", [])).toBe("reserved");
    expect(partialNameRefusal("content", [])).toBe("reserved");
  });

  it("refuses a name the vault already holds", () => {
    expect(partialNameRefusal("authors", ["authors", "venue-line"])).toBe(
      "duplicate",
    );
    expect(partialNameRefusal("editors", ["authors", "venue-line"])).toBeNull();
  });

  it("reads a hand-made uppercase file as the same name", () => {
    // `zotlit-partial.Authors.md` registers as `Authors`, and a
    // case-insensitive filesystem holds one file for both spellings.
    expect(partialNameRefusal("authors", ["Authors"])).toBe("duplicate");
    expect(partialNameRefusal("Authors", ["authors"])).toBe("duplicate");
  });
});
