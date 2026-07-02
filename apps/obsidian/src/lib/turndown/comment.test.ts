// @vitest-environment happy-dom
import TurndownService from "turndown";
import { describe, expect, it } from "vitest";

import { commentToMarkdown, createCommentTurndown } from "./comment";

const md = (html: string): string =>
  commentToMarkdown(createCommentTurndown(TurndownService), html);

describe("commentToMarkdown", () => {
  it("converts the four supported inline tags", () => {
    expect(md("a <b>bold</b> and <i>italic</i> word")).toBe(
      "a **bold** and _italic_ word",
    );
  });

  it("keeps sub/sup as HTML (no Markdown equivalent)", () => {
    expect(md("H<sub>2</sub>O and x<sup>2</sup>")).toBe(
      "H<sub>2</sub>O and x<sup>2</sup>",
    );
  });

  it("promotes literal newlines to hard line breaks instead of collapsing them", () => {
    expect(md("first line\nsecond line")).toBe("first line  \nsecond line");
  });

  it("returns an empty string for an empty comment", () => {
    expect(md("")).toBe("");
  });
});
