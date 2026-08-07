import { describe, expect, it } from "vitest";

import {
  citekeyMarks,
  isExcludedTokenClass,
  resolveCitekeyMarks,
} from "./decorate";

const never = (): boolean => false;

describe("citekeyMarks", () => {
  it("marks a bare citekey without its surrounding text", () => {
    expect(citekeyMarks("See @doe2024 for more.", never)).toEqual([
      { start: 4, end: 12, citekey: "doe2024" },
    ]);
  });

  it("marks every key of a citation cluster on its own", () => {
    expect(citekeyMarks("[see @a, p. 3; @b]", never)).toEqual([
      { start: 5, end: 7, citekey: "a" },
      { start: 15, end: 17, citekey: "b" },
    ]);
  });

  it("leaves the author-suppression dash outside the mark", () => {
    expect(citekeyMarks("[-@doe2024]", never)).toEqual([
      { start: 2, end: 10, citekey: "doe2024" },
    ]);
  });

  it("marks a braced key up to its closing brace", () => {
    expect(citekeyMarks("@{https://example.com/paper}", never)).toEqual([
      { start: 0, end: 28, citekey: "https://example.com/paper" },
    ]);
  });

  it("finds nothing in an email address", () => {
    expect(citekeyMarks("write to me@example.com today", never)).toEqual([]);
  });

  it("skips a span the editor rules out", () => {
    const marks = citekeyMarks(
      "@kept and @dropped",
      (span) => span.start === 10,
    );
    expect(marks).toEqual([{ start: 0, end: 5, citekey: "kept" }]);
  });
});

describe("resolveCitekeyMarks", () => {
  it("attaches resolution state per mark, keeping their spans and citekeys", () => {
    const marks = citekeyMarks("[see @a, p. 3; @b]", never);
    const resolved = new Set(["a"]);
    expect(
      resolveCitekeyMarks(marks, (citekey) => resolved.has(citekey)),
    ).toEqual([
      { start: 5, end: 7, citekey: "a", resolved: true },
      { start: 15, end: 17, citekey: "b", resolved: false },
    ]);
  });

  it("resolves nothing against an empty mark list", () => {
    expect(resolveCitekeyMarks([], () => true)).toEqual([]);
  });
});

describe("isExcludedTokenClass", () => {
  it("rules out code, math, comments, frontmatter, and URLs", () => {
    expect(isExcludedTokenClass("hmd-codeblock")).toBe(true);
    expect(isExcludedTokenClass("formatting formatting-code inline-code")).toBe(
      true,
    );
    expect(isExcludedTokenClass("math")).toBe(true);
    expect(isExcludedTokenClass("comment formatting comment-start")).toBe(true);
    expect(isExcludedTokenClass("hmd-frontmatter")).toBe(true);
    expect(isExcludedTokenClass("url")).toBe(true);
    expect(
      isExcludedTokenClass("HyperMD-codeblock HyperMD-codeblock-begin"),
    ).toBe(true);
  });

  it("leaves ordinary text and bare links alone", () => {
    expect(isExcludedTokenClass("")).toBe(false);
    expect(isExcludedTokenClass("hmd-barelink link")).toBe(false);
    expect(isExcludedTokenClass("em")).toBe(false);
  });
});
