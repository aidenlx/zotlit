import { describe, expect, it } from "vitest";

import { normalizeObsidianTag } from "./obsidian-tag";

describe("normalizeObsidianTag", () => {
  it("replaces a space with an underscore", () => {
    expect(normalizeObsidianTag("Machine Learning")).toBe("Machine_Learning");
  });

  it("collapses a run of disallowed characters into one underscore", () => {
    expect(normalizeObsidianTag("R & D")).toBe("R_D");
  });

  it("keeps underscores and hyphens the author wrote", () => {
    expect(normalizeObsidianTag("foo__bar")).toBe("foo__bar");
    expect(normalizeObsidianTag("a--b")).toBe("a--b");
  });

  it("trims underscores introduced at the edges", () => {
    expect(normalizeObsidianTag("(draft) papers")).toBe("draft_papers");
  });

  it("collapses repeated slashes and trims them from the edges", () => {
    expect(normalizeObsidianTag("/Reading/")).toBe("Reading");
    expect(normalizeObsidianTag("a//b")).toBe("a/b");
  });

  it("prefixes an all-digit name, which Obsidian rejects on its own", () => {
    expect(normalizeObsidianTag("1984")).toBe("_1984");
  });

  it("leaves a name that already holds a non-digit", () => {
    expect(normalizeObsidianTag("y1984")).toBe("y1984");
    expect(normalizeObsidianTag("a/1984")).toBe("a/1984");
  });

  it("returns an empty string when nothing survives", () => {
    expect(normalizeObsidianTag("!!!")).toBe("");
    expect(normalizeObsidianTag("   ")).toBe("");
    expect(normalizeObsidianTag("")).toBe("");
  });

  it("strips a leading hash so the filter is idempotent under a # prefix", () => {
    expect(normalizeObsidianTag("#todo")).toBe("todo");
  });

  it("treats a hash inside the name as a disallowed character", () => {
    expect(normalizeObsidianTag("a#b")).toBe("a_b");
  });

  it("keeps CJK text and CJK punctuation, which Obsidian accepts", () => {
    expect(normalizeObsidianTag("文献、综述")).toBe("文献、综述");
    expect(normalizeObsidianTag("重要！")).toBe("重要！");
  });

  it("keeps symbols outside the punctuation blocks", () => {
    expect(normalizeObsidianTag("A©B")).toBe("A©B");
  });

  it("keeps an emoji, including a variation selector and a skin tone", () => {
    expect(normalizeObsidianTag("emoji✌️here")).toBe("emoji✌️here");
    expect(normalizeObsidianTag("thumbs👍🏽")).toBe("thumbs👍🏽");
  });

  it("splits a zero-width-joiner emoji, as Obsidian's own tokenizer does", () => {
    expect(normalizeObsidianTag("👩‍💻")).toBe("👩_💻");
  });

  it("replaces non-ASCII whitespace and dashes from the punctuation blocks", () => {
    expect(normalizeObsidianTag("a\u00A0b")).toBe("a_b");
    expect(normalizeObsidianTag("a\u3000b")).toBe("a_b");
    expect(normalizeObsidianTag("a\u2014b")).toBe("a_b");
  });
});
