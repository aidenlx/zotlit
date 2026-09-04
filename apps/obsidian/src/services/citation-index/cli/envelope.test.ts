import { describe, expect, it } from "vitest";

import { ambiguousCandidates } from "@/services/citation-index/__fixtures__/ambiguous-candidates";

import {
  ambiguousCitekeyDiagnostic,
  DIAGNOSTIC_HINTS,
  envelope,
  reportCandidates,
} from "./envelope";
import type { ReferenceEntry } from "./envelope";

const CITEKEY = "doe2024";

describe("reportCandidates", () => {
  it("names each candidate by its exact key and its library's local id", () => {
    expect(reportCandidates(ambiguousCandidates)).toEqual([
      { key: "DOE2024A", libraryID: 1 },
      { key: "4/DOE2024B", libraryID: 4 },
    ]);
  });

  // Index facts only (ADR 0024): the summary a sidebar shows and the library
  // presentation it names stay with the surfaces that own them.
  it("carries no item summary and no library presentation", () => {
    for (const candidate of reportCandidates(ambiguousCandidates)) {
      expect(Object.keys(candidate)).toStrictEqual(["key", "libraryID"]);
    }
  });
});

describe("ambiguousCitekeyDiagnostic", () => {
  it("reports the candidates with the recovery action its code defines", () => {
    expect(
      ambiguousCitekeyDiagnostic(
        CITEKEY,
        reportCandidates(ambiguousCandidates),
      ),
    ).toEqual({
      code: "AMBIGUOUS_CITEKEY",
      message: `2 Zotero items carry the citation key '${CITEKEY}' in the current library scope.`,
      hint: DIAGNOSTIC_HINTS.AMBIGUOUS_CITEKEY,
      details: {
        citekey: CITEKEY,
        candidates: [
          { key: "DOE2024A", libraryID: 1 },
          { key: "4/DOE2024B", libraryID: 4 },
        ],
      },
    });
  });
});

describe("envelope", () => {
  it("carries an ambiguous reference entry at contract version 3", () => {
    const entry: ReferenceEntry = {
      refNumber: 1,
      kind: "ambiguous",
      citekey: CITEKEY,
      candidates: reportCandidates(ambiguousCandidates),
      occurrences: [],
    };

    expect(
      JSON.parse(
        envelope("zotlit:references", {
          ok: true,
          entries: [entry],
          omittedSyntaxes: [],
          database: "ready",
          resolution: "fresh",
          syntaxes: { citekey: "included", wikilink: "included" },
        }),
      ),
    ).toEqual({
      contractVersion: 3,
      command: "zotlit:references",
      ok: true,
      entries: [
        {
          refNumber: 1,
          kind: "ambiguous",
          citekey: CITEKEY,
          candidates: [
            { key: "DOE2024A", libraryID: 1 },
            { key: "4/DOE2024B", libraryID: 4 },
          ],
          occurrences: [],
        },
      ],
      omittedSyntaxes: [],
      database: "ready",
      resolution: "fresh",
      syntaxes: { citekey: "included", wikilink: "included" },
    });
  });
});
