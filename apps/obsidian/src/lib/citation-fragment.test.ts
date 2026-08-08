import { describe, expect, it } from "vitest";

import { CITATION_FRAGMENT_FIXTURES } from "./__fixtures__/citation-fragments";
import {
  citationDisplayText,
  parseCitationFragment,
} from "./citation-fragment";
import type { CitationLocatorLabel } from "./citation-fragment";

describe("parseCitationFragment", () => {
  for (const fixture of CITATION_FRAGMENT_FIXTURES) {
    const fragment = fixture.fragment;
    if (fragment === null) continue;
    const expected = fixture.error
      ? { ok: false, reason: fixture.error }
      : { ok: true, details: fixture.details };
    it(`matches the Lua filter for ${fixture.name}`, () => {
      expect(parseCitationFragment(fragment)).toEqual(expected);
    });
  }
});

describe("citationDisplayText", () => {
  it("uses the Citation Key Property value", () => {
    expect(
      citationDisplayText({
        citationKey: "wang2020",
        notePath: "literatures/wangMutationalClinicalSpectrum2020a.md",
        fragment: null,
      }),
    ).toEqual({ kind: "text", text: "@wang2020" });
  });

  it("falls back to the note's filename, never the folder path", () => {
    expect(
      citationDisplayText({
        citationKey: null,
        notePath: "literatures/wangMutationalClinicalSpectrum2020a.md",
        fragment: null,
      }),
    ).toEqual({ kind: "text", text: "@wangMutationalClinicalSpectrum2020a" });
  });

  it("treats an empty Citation Key Property value as missing", () => {
    expect(
      citationDisplayText({
        citationKey: "",
        notePath: "Doe 2020.md",
        fragment: null,
      }),
    ).toEqual({ kind: "text", text: "@Doe 2020" });
  });

  it("keeps the filename fallback inside a fragment rendering", () => {
    expect(
      citationDisplayText({
        citationKey: null,
        notePath: "Doe 2020.md",
        fragment: "locator=33",
      }),
    ).toEqual({ kind: "text", text: "[@Doe 2020, p. 33]" });
  });

  for (const fixture of CITATION_FRAGMENT_FIXTURES) {
    it(`renders ${fixture.name} from the shared fixtures`, () => {
      const result = citationDisplayText({
        citationKey: "doe2020",
        notePath: "Doe 2020.md",
        fragment: fixture.fragment,
      });
      expect(result).toEqual(
        fixture.error
          ? { kind: "raw" }
          : { kind: "text", text: fixture.display },
      );
    });
  }

  it("renders the standard short form for every locator label", () => {
    // Keyed on the label union, so adding a label fails here until it is covered.
    const shortForms: Readonly<Record<CitationLocatorLabel, string>> = {
      book: "bk.",
      chapter: "chap.",
      column: "col.",
      figure: "fig.",
      folio: "fol.",
      issue: "no.",
      line: "l.",
      note: "n.",
      opus: "op.",
      page: "p.",
      paragraph: "para.",
      part: "pt.",
      section: "sec.",
      "sub-verbo": "s.v.",
      verse: "v.",
      volume: "vol.",
    };
    for (const [label, short] of Object.entries(shortForms)) {
      expect(
        citationDisplayText({
          citationKey: "doe2020",
          notePath: "Doe 2020.md",
          fragment: `label=${label}&locator=3`,
        }),
      ).toEqual({ kind: "text", text: `[@doe2020, ${short} 3]` });
    }
  });
});
