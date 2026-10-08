import { describe, expect, it } from "vitest";

import { normalize, tokenize } from "./tokenizer";
import type { TokenizerOptions } from "./tokenizer";

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

  it("returns CJK tokens through Intl.Segmenter", () => {
    expect(tokenize("中文检索", opts())).not.toHaveLength(0);
  });

  it("splits hyphenated tokens even when Intl keeps them together", () => {
    expect(
      tokenize("ignored", {
        intl: fakeSegmenter([{ segment: "a-b-c", isWordLike: true }]),
      }),
    ).toEqual(["a", "b", "c"]);
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
