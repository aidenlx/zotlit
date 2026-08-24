import { describe, expect, it } from "vitest";

import type {
  CitationOccurrence,
  DocumentCitationError,
} from "@/services/citation-index/service";

import { buildReferenceEntries } from "./entries";

describe("buildReferenceEntries citation source errors", () => {
  it("keeps a malformed Citation Fragment as an unnumbered exact error", () => {
    const occurrence: CitationOccurrence = {
      kind: "wikilink",
      raw: "Rivers 2020",
      position: {
        start: { line: 4, col: 2, offset: 42 },
        end: { line: 4, col: 39, offset: 79 },
      },
    };
    const error: DocumentCitationError = {
      kind: "malformed-wikilink",
      occurrence,
    };

    expect(
      buildReferenceEntries([], new Map(), {
        bibliography: { entries: new Map(), complete: true },
        errors: [error],
      }),
    ).toStrictEqual([
      {
        id: "malformed:42",
        occurrences: [occurrence],
        kind: "malformed",
      },
    ]);
  });
});
