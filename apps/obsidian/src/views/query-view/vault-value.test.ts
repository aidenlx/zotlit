import { describe, expect, it } from "vitest";

import { dateInputValue, dateValue, linkOf, tagText } from "./vault-value";

describe("linkOf", () => {
  it("reads a whole wikilink as an internal link, shown by its alias or its target", () => {
    expect(linkOf("[[Communicating with Slip Boxes]]")).toEqual({
      kind: "internal",
      target: "Communicating with Slip Boxes",
      text: "Communicating with Slip Boxes",
    });
    expect(linkOf("[[notes/Memex|the memex]]")).toEqual({
      kind: "internal",
      target: "notes/Memex",
      text: "the memex",
    });
  });

  it("reads a Markdown link, a bare URL and an email as links", () => {
    expect(linkOf("[Bush](https://example.org/memex)")).toEqual({
      kind: "external",
      target: "https://example.org/memex",
      text: "Bush",
    });
    expect(linkOf("[Memex](notes/Memex.md)")).toEqual({
      kind: "internal",
      target: "notes/Memex.md",
      text: "Memex",
    });
    expect(linkOf("https://example.org")).toEqual({
      kind: "external",
      target: "https://example.org",
      text: "https://example.org",
    });
    expect(linkOf("ann@example.org")).toEqual({
      kind: "external",
      target: "mailto:ann@example.org",
      text: "ann@example.org",
    });
  });

  it("reads text that holds a link among other words as no link", () => {
    expect(linkOf("see [[Memex]]")).toBeNull();
    expect(linkOf("read")).toBeNull();
    expect(linkOf("[[a]] and [[b]]")).toBeNull();
  });
});

describe("the native date fields", () => {
  it("take a stored value in the form the field reads", () => {
    expect(dateInputValue("date", "2026-09-02")).toBe("2026-09-02");
    expect(dateInputValue("datetime", "2026-08-30 09:15")).toBe(
      "2026-08-30T09:15:00",
    );
    expect(dateInputValue("date", "someday")).toBe("");
  });

  it("give back the value the Properties panel writes", () => {
    expect(dateValue("date", "2026-09-02")).toBe("2026-09-02");
    expect(dateValue("datetime", "2026-08-30T09:15")).toBe(
      "2026-08-30T09:15:00",
    );
    expect(dateValue("datetime", "2026-08-30T09:15:07")).toBe(
      "2026-08-30T09:15:07",
    );
    expect(dateValue("date", "")).toBeNull();
  });
});

describe("tagText", () => {
  it("shows a tag without its #", () => {
    expect(tagText("#reading/done")).toBe("reading/done");
    expect(tagText("hci")).toBe("hci");
  });
});
