// The candidates of one Ambiguous Citation Key, shared by the surfaces that
// build and render its block.

import type { AmbiguousCandidate } from "@/services/citation-index/ambiguity";

/**
 * The two Items one Ambiguous Citation Key names, as a picker shows them: one
 * in the personal Library, one in a group Library, so a row's Library name and
 * Zotero item key both carry weight.
 */
export const ambiguousCandidates: readonly AmbiguousCandidate[] = [
  {
    itemID: 11,
    libraryID: 1,
    key: "DOE2024A",
    indexedKey: "DOE2024A",
    summary: "Doe (2024): A study of citations",
    library: { selector: { type: "personal" }, libraryID: 1, name: null },
  },
  {
    itemID: 12,
    libraryID: 4,
    key: "DOE2024B",
    indexedKey: "4/DOE2024B",
    summary: "Doe (2024): Another study",
    library: {
      selector: { type: "group", groupID: 7 },
      libraryID: 4,
      name: "Shared group",
    },
  },
];
