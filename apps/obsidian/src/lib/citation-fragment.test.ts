import { describe, expect, it } from "vitest";

import { CITATION_FRAGMENT_FIXTURES } from "./__fixtures__/citation-fragments";
import {
  citationDisplay,
  citationRunSource,
  isRenderableCitation,
  parseCitationFragment,
} from "./citation-fragment";
import type {
  CitationFragment,
  CitationLocatorLabel,
  CitationRunItem,
} from "./citation-fragment";

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

describe("citationDisplay", () => {
  it("uses the Citation Key Property value", () => {
    expect(
      citationDisplay({
        citationKey: "wang2020",
        notePath: "literatures/wangMutationalClinicalSpectrum2020a.md",
        fragment: null,
      }),
    ).toHaveProperty("text", "@wang2020");
  });

  it("falls back to the note's filename, never the folder path", () => {
    expect(
      citationDisplay({
        citationKey: null,
        notePath: "literatures/wangMutationalClinicalSpectrum2020a.md",
        fragment: null,
      }),
    ).toHaveProperty("text", "@wangMutationalClinicalSpectrum2020a");
  });

  it("treats an empty Citation Key Property value as missing", () => {
    expect(
      citationDisplay({
        citationKey: "",
        notePath: "Doe 2020.md",
        fragment: null,
      }),
    ).toHaveProperty("text", "@Doe 2020");
  });

  it("keeps the filename fallback inside a fragment rendering", () => {
    expect(
      citationDisplay({
        citationKey: null,
        notePath: "Doe 2020.md",
        fragment: "locator=33",
      }),
    ).toHaveProperty("text", "[@Doe 2020, p. 33]");
  });

  for (const fixture of CITATION_FRAGMENT_FIXTURES) {
    it(`renders ${fixture.name} from the shared fixtures`, () => {
      const result = citationDisplay({
        citationKey: "doe2020",
        notePath: "Doe 2020.md",
        fragment: fixture.fragment,
      });
      expect(result?.text ?? null).toBe(fixture.error ? null : fixture.display);
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
        citationDisplay({
          citationKey: "doe2020",
          notePath: "Doe 2020.md",
          fragment: `label=${label}&locator=3`,
        }),
      ).toHaveProperty("text", `[@doe2020, ${short} 3]`);
    }
  });
});

describe("citationRunSource", () => {
  /** One run item; the fragment names only what the case is about. */
  const item = (
    citekey: string,
    details: Partial<CitationFragment> = {},
  ): CitationRunItem => ({
    citekey,
    details: {
      mode: "normal",
      prefix: null,
      label: null,
      locator: null,
      suffix: null,
      ...details,
    },
  });

  it("writes a lone Citation as the bracketed cluster the exporter writes", () => {
    expect(citationRunSource([item("doe2020")]).source).toBe("[@doe2020]");
  });

  it("writes a run as one bracketed cluster, as export groups it", () => {
    expect(citationRunSource([item("doe2020"), item("wang2020")]).source).toBe(
      "[@doe2020; @wang2020]",
    );
  });

  it("keeps each item's own prefix, locator, and suffix", () => {
    expect(
      citationRunSource([
        item("doe2020", {
          prefix: "see also",
          locator: "40",
          suffix: "for context",
        }),
        item("wang2020", { label: "chapter", locator: "2" }),
      ]).source,
    ).toBe("[see also @doe2020, p. 40, for context; @wang2020, chap. 2]");
  });

  it("keeps author suppression inside a run", () => {
    expect(
      citationRunSource([
        item("doe2020"),
        item("wang2020", { mode: "suppress-author", locator: "3" }),
      ]).source,
    ).toBe("[@doe2020; -@wang2020, p. 3]");
  });

  // The citekey syntax cannot write an author-in-text item inside a cluster
  // either, so both syntaxes read the run the same way.
  it("writes an author-in-text item as a plain entry once it joins a run", () => {
    expect(
      citationRunSource([
        item("doe2020", { mode: "author-in-text" }),
        item("wang2020", { mode: "suppress-author", locator: "3" }),
      ]).source,
    ).toBe("[@doe2020; -@wang2020, p. 3]");
  });

  it("keeps the textual form for a standalone author-in-text Citation", () => {
    expect(
      citationRunSource([
        item("doe2020", { mode: "author-in-text", locator: "62" }),
      ]).source,
    ).toBe("@doe2020 [p. 62]");
  });

  it("locates every key it writes, suppression marker included", () => {
    const { source, keys } = citationRunSource([
      item("doe2020", { prefix: "see" }),
      item("wang2020", { mode: "suppress-author" }),
    ]);

    expect(
      keys.map(({ citekey, start, end }) => [
        citekey,
        source.slice(start, end),
      ]),
    ).toEqual([
      ["doe2020", "@doe2020"],
      ["wang2020", "-@wang2020"],
    ]);
  });
});

describe("isRenderableCitation", () => {
  const source = (
    citekey: string,
    details: Partial<CitationFragment> = {},
  ): ReturnType<typeof citationRunSource> =>
    citationRunSource([
      {
        citekey,
        details: {
          mode: "normal",
          prefix: null,
          label: null,
          locator: null,
          suffix: null,
          ...details,
        },
      },
    ]);

  it("accepts a plain citekey cluster", () => {
    expect(isRenderableCitation(source("doe2020"))).toBe(true);
  });

  it("accepts a key the braced form carries", () => {
    const derived = source("doe,2020");
    expect(derived.source).toBe("[@{doe,2020}]");
    expect(isRenderableCitation(derived)).toBe(true);
  });

  it("accepts the textual form of a standalone author-in-text Citation", () => {
    expect(
      isRenderableCitation(
        source("doe2020", { mode: "author-in-text", locator: "62" }),
      ),
    ).toBe(true);
  });

  // A note filename standing in for a missing Citation Key Property: no Pandoc
  // key carries a space, braced or not.
  it("rejects a key holding a space", () => {
    expect(isRenderableCitation(source("Doe 2020"))).toBe(false);
  });

  it("rejects a suffix holding the separator that ends an item", () => {
    expect(
      isRenderableCitation(source("doe2020", { suffix: "see 5; 6" })),
    ).toBe(false);
  });
});
