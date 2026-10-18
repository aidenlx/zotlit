import { describe, expect, it } from "vitest";

import { suggestionsFor } from "./vault-editors";

describe("suggestionsFor", () => {
  const values = ["read", "reading", "to-read", "unread", "skimmed"];

  it("leads with the typed text, then the vault's values that match it", () => {
    expect(suggestionsFor(values, "rea")).toEqual([
      "rea",
      "read",
      "reading",
      "to-read",
      "unread",
    ]);
  });

  it("does not repeat the typed text when the vault holds it", () => {
    expect(suggestionsFor(values, "read ")).toEqual([
      "read",
      "reading",
      "to-read",
      "unread",
    ]);
  });

  it("leaves out the values a list holds already", () => {
    expect(suggestionsFor(values, "read", ["read", "unread"])).toEqual([
      "reading",
      "to-read",
    ]);
  });

  it("suggests nothing before a key is typed", () => {
    expect(suggestionsFor(values, "  ")).toEqual([]);
  });
});
