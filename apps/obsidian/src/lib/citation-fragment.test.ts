import { describe, expect, it } from "vitest";

import { CITATION_FRAGMENT_FIXTURES } from "./__fixtures__/citation-fragments";
import { citationRunItem, parseCitationFragment } from "./citation-fragment";
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

describe("citationRunItem", () => {
  it("uses the native citation key", () => {
    expect(
      citationRunItem({
        citationKey: "wang2020",
        notePath: "literatures/wangMutationalClinicalSpectrum2020a.md",
        fragment: null,
      }),
    ).toMatchObject({ citekey: "wang2020" });
  });

  it("falls back to the Literature Note filename", () => {
    expect(
      citationRunItem({
        citationKey: null,
        notePath: "literatures/wangMutationalClinicalSpectrum2020a.md",
        fragment: null,
      }),
    ).toMatchObject({ citekey: "wangMutationalClinicalSpectrum2020a" });
  });

  it("returns null for a malformed Citation Fragment", () => {
    expect(
      citationRunItem({
        citationKey: "doe2024",
        notePath: "Doe.md",
        fragment: "mode=unknown",
      }),
    ).toBeNull();
  });

  it("prepares the short Locator Label in the data layer", () => {
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
    for (const [label, labelShort] of Object.entries(shortForms)) {
      expect(
        citationRunItem({
          citationKey: "doe2024",
          notePath: "Doe.md",
          fragment: `label=${label}&locator=3`,
        }),
      ).toMatchObject({ labelShort });
    }
  });
});
