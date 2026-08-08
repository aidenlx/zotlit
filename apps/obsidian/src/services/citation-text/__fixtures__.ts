// The one cited work, and the Citation Index answer naming it, that the citation-text suites read against.

import type { Citation } from "@/services/citation-index/service";

export const ALPHA_KEY = "1/ALPHA123";

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

/** One formatted citation, as the render cache hands it over. */
export function fragment(text: string): DocumentFragment {
  const content = document.createDocumentFragment();
  content.append(text);
  return content;
}
