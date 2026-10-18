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

  it("suggests the values that hold the typed text, as a Bases cell ranks them, and not the text itself", () => {
    // The earlier the text stands, the better; then the shorter value.
    expect(suggestionsFor(values, "REA")).toEqual([
      "read",
      "Reading 9",
      "Reading 10",
      "unread",
      "to-read",
    ]);
    // The text whole, not its letters apart, and a space is part of it.
    expect(suggestionsFor(values, "rd")).toEqual([]);
    expect(suggestionsFor(values, "ing 1")).toEqual(["Reading 10"]);
    // A value that holds the text twice ranks after one that holds it once.
    expect(suggestionsFor(["a-b-a", "xxxa"], "a")).toEqual(["xxxa", "a-b-a"]);
    expect(suggestionsFor(values, "nothing")).toEqual([]);
  });

  it("suggests the tags that match the typed text fuzzily, as Obsidian's tag suggest does", () => {
    expect(
      suggestionsFor(["reading/done", "hci", "Reading"], "rd", { tags: true }),
    ).toEqual(["Reading", "reading/done"]);
  });

  it("leaves out the values a list holds already", () => {
    expect(
      suggestionsFor(values, "", { taken: ["read", "unread", "skimmed"] }),
    ).toEqual(["Reading 9", "Reading 10", "to-read"]);
    expect(
      suggestionsFor(values, "read", { taken: ["read", "unread"] }),
    ).toEqual(["Reading 9", "Reading 10", "to-read"]);
  });
});
