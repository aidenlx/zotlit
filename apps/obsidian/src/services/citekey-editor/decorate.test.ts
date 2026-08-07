import { describe, expect, it } from "vitest";

import {
  citationRanges,
  citekeyMarks,
  isExcludedTokenClass,
  marksOutside,
  overlapsSelection,
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

describe("citationRanges", () => {
  it("reads a cluster whole and a bare key on its own", () => {
    expect(
      citationRanges("Blah [see @a, p. 3; @b] and @c.", never).map(
        (citation) => citation.source,
      ),
    ).toEqual(["[see @a, p. 3; @b]", "@c"]);
  });

  it("keeps each key at its offset within the citation's own source", () => {
    expect(citationRanges("x [see @a; @b] y", never)).toEqual([
      {
        start: 2,
        end: 14,
        source: "[see @a; @b]",
        keys: [
          { citekey: "a", start: 5, end: 7 },
          { citekey: "b", start: 9, end: 11 },
        ],
      },
    ]);
  });

  it("takes the author-suppression dash into the citation", () => {
    expect(
      citationRanges("-@doe2024 said so.", never).map(
        (citation) => citation.source,
      ),
    ).toEqual(["-@doe2024"]);
  });

  it("skips a citation the editor rules out", () => {
    expect(
      citationRanges("@kept and [@dropped]", (span) => span.start === 10).map(
        (citation) => citation.source,
      ),
    ).toEqual(["@kept"]);
  });
});

describe("marksOutside", () => {
  const line = "[see @a; @b] and @c";

  it("drops the marks a replaced citation covers", () => {
    const [cluster] = citationRanges(line, never);
    expect(marksOutside(citekeyMarks(line, never), [cluster!])).toEqual([
      { start: 17, end: 19, citekey: "c" },
    ]);
  });

  it("keeps every mark when nothing is replaced", () => {
    expect(marksOutside(citekeyMarks(line, never), [])).toHaveLength(3);
  });
});

describe("overlapsSelection", () => {
  const range = { from: 4, to: 4 };

  it("counts a cursor at either end of the span, as Obsidian does", () => {
    expect(overlapsSelection([range], 4, 10)).toBe(true);
    expect(overlapsSelection([{ from: 10, to: 10 }], 4, 10)).toBe(true);
  });

  it("counts a selection that crosses the span", () => {
    expect(overlapsSelection([{ from: 2, to: 20 }], 4, 10)).toBe(true);
  });

  it("leaves a span no range touches alone", () => {
    expect(overlapsSelection([range], 6, 10)).toBe(false);
    expect(overlapsSelection([{ from: 11, to: 14 }], 4, 10)).toBe(false);
  });

  it("touches nothing without a range, which is how a blurred editor reads", () => {
    expect(overlapsSelection([], 4, 10)).toBe(false);
  });
});
