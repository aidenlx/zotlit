import { describe, expect, it } from "vitest";

import {
  normalize,
  tokenize,
  type ChsSegmenter,
  type TokenizerOptions,
} from "./tokenizer";

describe("item lookup tokenizer", () => {
  it("splits ASCII words and hyphenated terms", () => {
    expect(normalizedTokens("Cross-sectional study")).toEqual([
      "cross",
      "sectional",
      "study",
    ]);
  });

  it("normalizes Latin diacritics", () => {
    expect(normalizedTokens("García-López")).toEqual(["garcia", "lopez"]);
  });

  it("returns CJK tokens without the optional segmenter", () => {
    expect(tokenize("中文检索", opts())).not.toHaveLength(0);
  });

  it("uses the optional Chinese segmenter for CJK segments", () => {
    const chsSegmenter: ChsSegmenter = {
      cut: () => ["中文", "检索"],
    };

    expect(
      tokenize("中文检索", {
        intl: fakeSegmenter([{ segment: "中文检索", isWordLike: true }]),
        chsSegmenter,
      }),
    ).toEqual(["中文", "检索"]);
  });

  it("splits hyphenated tokens even when Intl keeps them together", () => {
    expect(
      tokenize("ignored", {
        intl: fakeSegmenter([{ segment: "a-b-c", isWordLike: true }]),
      }),
    ).toEqual(["a", "b", "c"]);
  });

  it("handles mixed ASCII, CJK, and numeric text", () => {
    const chsSegmenter: ChsSegmenter = {
      cut: () => ["等", "2020"],
    };

    expect(
      tokenize("Smith等2020", {
        intl: fakeSegmenter([
          { segment: "Smith", isWordLike: true },
          { segment: "等2020", isWordLike: true },
        ]),
        chsSegmenter,
      }),
    ).toEqual(["Smith", "等", "2020"]);
  });

  it("normalizes Polish l stroke", () => {
    expect(normalize("Łukasiewicz")).toBe("lukasiewicz");
  });
});

function normalizedTokens(text: string): string[] {
  return tokenize(text, opts()).map(normalize);
}

function opts(): TokenizerOptions {
  return {
    intl: new Intl.Segmenter(undefined, { granularity: "word" }),
  };
}

function fakeSegmenter(
  parts: Array<{ segment: string; isWordLike: boolean }>,
): Intl.Segmenter {
  return {
    segment: () => parts,
  } as unknown as Intl.Segmenter;
}
