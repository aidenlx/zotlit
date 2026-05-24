import { regex } from "arkregex";

export interface ChsSegmenter {
  cut(word: string, opts: { search: boolean }): string[];
}

export interface TokenizerOptions {
  intl: Intl.Segmenter;
  chsSegmenter?: ChsSegmenter | null;
}

const CJK = regex("[\\u4e00-\\u9fa5]", "u");
const DIACRITIC = regex("\\p{Diacritic}", "gu");

export function tokenize(text: string, opts: TokenizerOptions): string[] {
  const tokens: string[] = [];
  for (const part of opts.intl.segment(text)) {
    if (!part.isWordLike) continue;
    for (const token of segmentCjk(part.segment, opts.chsSegmenter)) {
      tokens.push(...splitHyphenated(token));
    }
  }
  return tokens;
}

export function normalize(term: string): string {
  return (
    term
      .toLowerCase()
      // NFD does not decompose Polish ł.
      .replaceAll("ł", "l")
      .normalize("NFD")
      .replace(DIACRITIC, "")
  );
}

/**
 * @returns the normalized string and an index map from normalized code-unit
 * offsets back to the original. The map has one trailing entry equal to
 * `text.length` so a `[start, end]` range maps cleanly at both endpoints.
 */
export function normalizeWithIndexMap(text: string): {
  normalized: string;
  indexMap: number[];
} {
  const parts: string[] = [];
  const indexMap: number[] = [];
  let sourceIndex = 0;
  // for…of yields full code points, so surrogate-pair chars (emoji, some
  // CJK extensions) are normalized as one unit instead of as two lone
  // halves. char.length is 2 for surrogate pairs, keeping `sourceIndex`
  // aligned with the original UTF-16 offsets that `SearchMatches` uses.
  for (const char of text) {
    const piece = normalize(char);
    for (let j = 0; j < piece.length; j++) indexMap.push(sourceIndex);
    parts.push(piece);
    sourceIndex += char.length;
  }
  indexMap.push(text.length);
  return { normalized: parts.join(""), indexMap };
}

function segmentCjk(
  segment: string,
  chsSegmenter: ChsSegmenter | null | undefined,
): string[] {
  if (!chsSegmenter || !CJK.test(segment)) return [segment];
  return chsSegmenter.cut(segment, { search: true });
}

function splitHyphenated(token: string): string[] {
  return token.split("-").filter((part) => part.length > 0);
}
