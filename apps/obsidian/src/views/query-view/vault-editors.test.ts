import { describe, expect, it } from "vitest";

import { suggestionsFor } from "./vault-editors";

describe("suggestionsFor", () => {
  const values = [
    "unread",
    "to-read",
    "Reading 10",
    "skimmed",
    "read",
    "Reading 9",
  ];

  it("suggests every value before a key is typed, in Obsidian's order", () => {
    expect(suggestionsFor(values, "  ")).toEqual([
      "read",
      "Reading 9",
      "Reading 10",
      "skimmed",
      "to-read",
      "unread",
    ]);
  });

  it("suggests the values that match the typed text, the best match first, and not the text itself", () => {
    expect(suggestionsFor(values, "rea")).toEqual([
      "read",
      "Reading 9",
      "Reading 10",
      "unread",
      "to-read",
    ]);
    // A fuzzy match; equal matches keep their order.
    expect(suggestionsFor(values, "rd")).toEqual([
      "read",
      "Reading 9",
      "Reading 10",
      "to-read",
      "unread",
    ]);
    expect(suggestionsFor(values, "nothing")).toEqual([]);
  });

  it("leaves out the values a list holds already", () => {
    expect(suggestionsFor(values, "", ["read", "unread", "skimmed"])).toEqual([
      "Reading 9",
      "Reading 10",
      "to-read",
    ]);
    expect(suggestionsFor(values, "read", ["read", "unread"])).toEqual([
      "Reading 9",
      "Reading 10",
      "to-read",
    ]);
  });
});
