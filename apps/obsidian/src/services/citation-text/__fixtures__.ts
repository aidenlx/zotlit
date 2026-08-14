// The one cited work, and the Citation Index answer naming it, that the citation-text suites read against.

import { scanDocumentCitations } from "@/services/citation-index/service";
import type {
  Citation,
  CitationOccurrence,
} from "@/services/citation-index/service";
import type { RenderedCitation } from "@/services/pandoc/engine";
import { inlineText } from "@/services/pandoc/inline-content";

import type { FormattedOccurrence, PresentedCitation } from "./present";

/** The Indexed Key of the cited work, which is also the CSL id a render names it by. */
export const ALPHA_KEY = "ALPHA234";

/**
 * The Item the stubbed database answers with. A suite mocks `@zotlit/db` so
 * `resolveIndexedKeyLibrary` and `getItemsByKey` hand this back, since the stub
 * client runs no queries; `itemSummary` reads it as `Zeta (2020)`.
 */
export const ALPHA = {
  key: "ALPHA123",
  itemID: 1,
  groupID: null,
  indexedKey: ALPHA_KEY,
  creators: [{ creatorType: "author", lastName: "Zeta", firstName: "Ann" }],
  primaryCreatorType: "author",
  customFields: [],
  fields: {
    itemType: "book",
    title: "A study of nothing",
    date: "2020",
  },
};

/**
 * One Citation Index answer.
 *
 * @param indexedKey the Indexed Key the citekey reaches, or null for a key that
 *   reaches no Literature Note.
 */
export function citation(
  citekey: string,
  indexedKey: string | null = ALPHA_KEY,
): Citation {
  return {
    indexedKey,
    linkpath: indexedKey === null ? null : "Zeta 2020",
    refNumber: 1,
    occurrences: [
      {
        kind: "citekey",
        raw: citekey,
        position: {
          start: { line: 0, col: 0, offset: 0 },
          end: { line: 0, col: 0, offset: 0 },
        },
      },
    ],
  };
}

export function literalOccurrences(body: string): CitationOccurrence[] {
  return scanDocumentCitations(body)
    .flatMap((source) => source.keys)
    .map((key) => ({
      kind: "citekey",
      raw: key.citekey,
      position: {
        start: { line: 0, col: key.start, offset: key.start },
        end: { line: 0, col: key.end, offset: key.end },
      },
    }));
}

/** One formatted citation, as the render cache hands it over. */
export function rendered(text: string): RenderedCitation {
  return { content: [{ t: "Str", c: text }], citations: [] };
}

/** One formatted citation as a surface holds it, standing for no note. */
export function presented(text: string): PresentedCitation {
  return { text: rendered(text), serials: [] };
}

/**
 * One formatted citation of a note-class style: the works it names read out of
 * the source, and a note where an in-text style would have written the text.
 *
 * @param source the citation as the render was asked for it, whose keys are
 *   the CSL ids the render answers with.
 */
export function noted(source: string): RenderedCitation {
  return {
    content: [
      {
        t: "Cite",
        c: [
          [],
          [{ t: "Note", c: [{ t: "Para", c: [{ t: "Str", c: source }] }] }],
        ],
      },
    ],
    citations: scanDocumentCitations(source).flatMap(({ keys }) =>
      keys.map(({ citekey }) => ({ id: citekey, mode: "normal" as const })),
    ),
  };
}

/**
 * The one occurrence a document holding a Citation once writes of it, for a
 * suite that stands in for a whole read.
 */
export function occurrences(
  text: RenderedCitation,
  start = 0,
): FormattedOccurrence[] {
  return [{ start, text, serials: [] }];
}

/**
 * The text every occurrence of one held Citation reads as, in document order,
 * which is what a suite asserting on a position-dependent render asserts on.
 */
export function occurrenceTexts(
  held: readonly FormattedOccurrence[] = [],
): string[] {
  return held.map(({ text }) => inlineText(text.content));
}

/** The text one held Citation's first occurrence reads as. */
export function firstText(
  held: readonly FormattedOccurrence[] = [],
): string | undefined {
  return occurrenceTexts(held)[0];
}
