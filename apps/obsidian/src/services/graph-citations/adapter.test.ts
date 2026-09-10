import { describe, expect, it } from "vitest";

import type { CitationOccurrence } from "@/services/citation-index/scan";
import type { CitekeyResolution } from "@/services/citation-index/service";

import { citedWorkNodeId, graphCitationAdditions } from "./adapter";
import type {
  GraphCitationFilters,
  GraphCitationInput,
  LinkMap,
} from "./adapter";

const DOE = {
  itemID: 1,
  libraryID: 1,
  key: "DOE00001",
  indexedKey: "DOE00001",
};
const ROE = {
  itemID: 2,
  libraryID: 1,
  key: "ROE00002",
  indexedKey: "ROE00002",
};
const ROE_GROUP = {
  itemID: 3,
  libraryID: 4,
  key: "ROE00002",
  indexedKey: "4_ROE00002",
};
const POE = {
  itemID: 5,
  libraryID: 1,
  key: "POE00005",
  indexedKey: "POE00005",
};

/** The fixture's Zotero: three Items, one of them also in a group Library. */
const RESOLUTIONS: Record<string, CitekeyResolution> = {
  doe2024: { kind: "unique", item: DOE },
  roe2025: { kind: "ambiguous", candidates: [ROE, ROE_GROUP] },
  typo2024: { kind: "missing" },
  "lee/2023": { kind: "unique", item: ROE },
  poe2021: { kind: "unique", item: POE },
};

/** Doe has one Literature Note, Poe two; Roe (unique under `lee/2023`) has none. */
const NOTES: Record<string, string[]> = {
  DOE00001: ["Literature/Doe 2024.md"],
  POE00005: ["Literature/Poe 2021.md", "Literature/Poe 2021 reread.md"],
};

/** What each linkpath in the fixture's vault resolves to, as Obsidian answers it. */
const LINK_TARGETS: Record<string, string> = {
  "Doe 2024": "Literature/Doe 2024.md",
  "Poe 2021": "Literature/Poe 2021.md",
  "Poe 2021 reread": "Literature/Poe 2021 reread.md",
  Other: "Other.md",
};

function occurrence(
  kind: CitationOccurrence["kind"],
  raw: string,
): CitationOccurrence {
  return {
    kind,
    raw,
    position: {
      start: { line: 0, col: 0, offset: 0 },
      end: { line: 0, col: 0, offset: 0 },
    },
  };
}

/** The rows a first-time reader finds: both syntaxes drawn, every node kept. */
const ROWS_AS_DEFAULT: GraphCitationFilters = {
  pandocCitations: true,
  wikilinkCitations: true,
  citationConnectedOnly: false,
};

function input(
  occurrences: Record<string, CitationOccurrence[]>,
  overrides: Partial<GraphCitationInput> = {},
): GraphCitationInput {
  return {
    occurrences: new Map(Object.entries(occurrences)),
    resolveCitekey: (citekey) => RESOLUTIONS[citekey] ?? null,
    resolveLink: (linkpath) => LINK_TARGETS[linkpath] ?? null,
    notePathsOf: (indexedKey) => NOTES[indexedKey] ?? [],
    literatureNotes: Object.values(NOTES).flat(),
    resolvedLinks: {},
    filters: ROWS_AS_DEFAULT,
    ...overrides,
  };
}

function filters(
  overrides: Partial<GraphCitationFilters>,
): GraphCitationFilters {
  return { ...ROWS_AS_DEFAULT, ...overrides };
}

function summary(additions: ReturnType<typeof graphCitationAdditions>) {
  return {
    resolved: additions.resolvedLinks,
    unresolved: additions.unresolvedLinks,
    nodes: [...additions.citedWorkNodes],
  };
}

describe("graphCitationAdditions", () => {
  it("links a Pandoc citation to its Literature Note", () => {
    const additions = graphCitationAdditions(
      input({ "Draft.md": [occurrence("citekey", "doe2024")] }),
    );

    expect(summary(additions)).toEqual({
      resolved: { "Draft.md": { "Literature/Doe 2024.md": 1 } },
      unresolved: {},
      nodes: [],
    });
  });

  it("adds nothing for a wikilink citation, which the vault already links", () => {
    const additions = graphCitationAdditions(
      input(
        { "Draft.md": [occurrence("wikilink", "Doe 2024")] },
        { resolvedLinks: { "Draft.md": { "Literature/Doe 2024.md": 1 } } },
      ),
    );

    expect(summary(additions)).toEqual({
      resolved: {},
      unresolved: {},
      nodes: [],
    });
  });

  it("draws one edge when a note cites the same work by wikilink and by citekey", () => {
    const additions = graphCitationAdditions(
      input(
        {
          "Draft.md": [
            occurrence("wikilink", "Doe 2024"),
            occurrence("citekey", "doe2024"),
          ],
        },
        { resolvedLinks: { "Draft.md": { "Literature/Doe 2024.md": 1 } } },
      ),
    );

    expect(summary(additions)).toEqual({
      resolved: {},
      unresolved: {},
      nodes: [],
    });
  });

  it("links to the Item's first Literature Note when the source links none of them", () => {
    const additions = graphCitationAdditions(
      input({ "Draft.md": [occurrence("citekey", "poe2021")] }),
    );

    expect(summary(additions)).toEqual({
      resolved: { "Draft.md": { "Literature/Poe 2021.md": 1 } },
      unresolved: {},
      nodes: [],
    });
  });

  it("adds nothing when the source already wikilinks another Literature Note of the Item", () => {
    const additions = graphCitationAdditions(
      input(
        {
          "Draft.md": [
            occurrence("wikilink", "Poe 2021 reread"),
            occurrence("citekey", "poe2021"),
          ],
        },
        {
          resolvedLinks: { "Draft.md": { "Literature/Poe 2021 reread.md": 1 } },
        },
      ),
    );

    expect(summary(additions)).toEqual({
      resolved: {},
      unresolved: {},
      nodes: [],
    });
  });

  it("draws a Cited Work Node for an ambiguous citekey", () => {
    const additions = graphCitationAdditions(
      input({ "Draft.md": [occurrence("citekey", "roe2025")] }),
    );

    expect(summary(additions)).toEqual({
      resolved: {},
      unresolved: { "Draft.md": { "@roe2025": 1 } },
      nodes: [["@roe2025", "roe2025"]],
    });
  });

  it("draws a Cited Work Node for a missing citekey and for one the snapshot cannot answer", () => {
    const additions = graphCitationAdditions(
      input({
        "Draft.md": [
          occurrence("citekey", "typo2024"),
          occurrence("citekey", "unknown2020"),
        ],
      }),
    );

    expect(summary(additions)).toEqual({
      resolved: {},
      unresolved: { "Draft.md": { "@typo2024": 1, "@unknown2020": 1 } },
      nodes: [
        ["@typo2024", "typo2024"],
        ["@unknown2020", "unknown2020"],
      ],
    });
  });

  it("draws a Cited Work Node for a unique Item with no Literature Note", () => {
    const additions = graphCitationAdditions(
      input({ "Draft.md": [occurrence("citekey", "lee/2023")] }),
    );

    expect(summary(additions)).toEqual({
      resolved: {},
      unresolved: { "Draft.md": { "@lee∕2023": 1 } },
      nodes: [["@lee∕2023", "lee/2023"]],
    });
  });

  it("gives a Cited Work Node an id with no slash", () => {
    expect(citedWorkNodeId("smith/2020/a")).toBe("@smith∕2020∕a");
    expect(citedWorkNodeId("smith2020")).toBe("@smith2020");
  });

  it("collapses repeated citations of one work into one edge per note", () => {
    const additions = graphCitationAdditions(
      input({
        "Draft.md": [
          occurrence("citekey", "doe2024"),
          occurrence("citekey", "typo2024"),
          occurrence("citekey", "doe2024"),
          occurrence("citekey", "typo2024"),
        ],
        "Other.md": [occurrence("citekey", "typo2024")],
      }),
    );

    expect(summary(additions)).toEqual({
      resolved: { "Draft.md": { "Literature/Doe 2024.md": 1 } },
      unresolved: {
        "Draft.md": { "@typo2024": 1 },
        "Other.md": { "@typo2024": 1 },
      },
      nodes: [["@typo2024", "typo2024"]],
    });
  });

  it("keeps the vault's own links out of the additions", () => {
    const resolvedLinks: LinkMap = {
      "Draft.md": { "Literature/Doe 2024.md": 2, "Other.md": 1 },
    };
    const additions = graphCitationAdditions(
      input(
        {
          "Draft.md": [occurrence("citekey", "doe2024")],
          "Other.md": [occurrence("citekey", "doe2024")],
        },
        { resolvedLinks },
      ),
    );

    expect(summary(additions)).toEqual({
      resolved: { "Other.md": { "Literature/Doe 2024.md": 1 } },
      unresolved: {},
      nodes: [],
    });
    expect(resolvedLinks).toEqual({
      "Draft.md": { "Literature/Doe 2024.md": 2, "Other.md": 1 },
    });
  });
});

describe("graphCitationAdditions under the Filters rows", () => {
  it("draws no citation edge while Pandoc citations is off", () => {
    const additions = graphCitationAdditions(
      input(
        {
          "Draft.md": [
            occurrence("citekey", "doe2024"),
            occurrence("citekey", "typo2024"),
          ],
        },
        { filters: filters({ pandocCitations: false }) },
      ),
    );

    expect(summary(additions)).toEqual({
      resolved: {},
      unresolved: {},
      nodes: [],
    });
    expect(additions.hiddenLinks).toEqual({});
    expect(additions.survivingPaths).toBeNull();
  });

  it("names every Literature Note, cited or not", () => {
    const additions = graphCitationAdditions(input({}));

    expect([...additions.literatureNotes]).toEqual([
      "Literature/Doe 2024.md",
      "Literature/Poe 2021.md",
      "Literature/Poe 2021 reread.md",
    ]);
  });

  it("takes each note's own Wikilink Citations away while that row is off, and draws the citekey edge itself", () => {
    const additions = graphCitationAdditions(
      input(
        {
          "Draft.md": [
            occurrence("wikilink", "Doe 2024"),
            occurrence("citekey", "doe2024"),
          ],
          "Reading.md": [occurrence("wikilink", "Poe 2021")],
        },
        {
          resolvedLinks: {
            "Draft.md": { "Literature/Doe 2024.md": 1, "Other.md": 1 },
            "Reading.md": { "Literature/Poe 2021.md": 1 },
          },
          filters: filters({ wikilinkCitations: false }),
        },
      ),
    );

    expect(summary(additions)).toEqual({
      resolved: { "Draft.md": { "Literature/Doe 2024.md": 1 } },
      unresolved: {},
      nodes: [],
    });
    expect(additions.hiddenLinks).toEqual({
      "Draft.md": { "Literature/Doe 2024.md": 1 },
      "Reading.md": { "Literature/Poe 2021.md": 1 },
    });
  });

  it("leaves an aliased link, a heading link, and a block link to a Literature Note alone: no Citation Index occurrence names them", () => {
    const additions = graphCitationAdditions(
      input(
        // `[[Doe 2024|alias]]`, `[[Doe 2024#Notes]]`, and `[[Poe 2021#^a1]]`
        // are no Wikilink Citations, so the index reports none of them.
        { "Draft.md": [occurrence("citekey", "doe2024")] },
        {
          resolvedLinks: {
            "Draft.md": { "Literature/Doe 2024.md": 2 },
            "Reading.md": { "Literature/Poe 2021.md": 1 },
          },
          filters: filters({ wikilinkCitations: false }),
        },
      ),
    );

    expect(additions.hiddenLinks).toEqual({});
    // The vault still draws the edge, so the citekey adds none of its own.
    expect(summary(additions).resolved).toEqual({});
  });

  it("keeps the ordinary link while taking away the Wikilink Citation beside it", () => {
    const additions = graphCitationAdditions(
      input(
        // The note writes `[[Doe 2024]]` once and `[[Doe 2024|alias]]` once,
        // so the vault counts two links and one of them is a Citation.
        { "Draft.md": [occurrence("wikilink", "Doe 2024")] },
        {
          resolvedLinks: { "Draft.md": { "Literature/Doe 2024.md": 2 } },
          filters: filters({ wikilinkCitations: false }),
        },
      ),
    );

    expect(additions.hiddenLinks).toEqual({
      "Draft.md": { "Literature/Doe 2024.md": 1 },
    });
  });

  it("takes away one Literature Note's Wikilink Citation of another", () => {
    const additions = graphCitationAdditions(
      input(
        {
          "Literature/Poe 2021.md": [occurrence("wikilink", "Doe 2024")],
        },
        {
          resolvedLinks: {
            "Literature/Poe 2021.md": { "Literature/Doe 2024.md": 1 },
          },
          filters: filters({ wikilinkCitations: false }),
        },
      ),
    );

    expect(additions.hiddenLinks).toEqual({
      "Literature/Poe 2021.md": { "Literature/Doe 2024.md": 1 },
    });
  });

  it("leaves those links alone while the vault-wide setting excludes the syntax", () => {
    const additions = graphCitationAdditions(
      input(
        { "Draft.md": [occurrence("citekey", "doe2024")] },
        {
          resolvedLinks: { "Draft.md": { "Literature/Doe 2024.md": 1 } },
          filters: filters({ wikilinkCitations: null }),
        },
      ),
    );

    expect(summary(additions)).toEqual({
      resolved: {},
      unresolved: {},
      nodes: [],
    });
    expect(additions.hiddenLinks).toEqual({});
  });

  it("keeps Literature Notes and the notes that cite one under Citation-connected only", () => {
    const additions = graphCitationAdditions(
      input(
        {
          "Draft.md": [occurrence("citekey", "doe2024")],
          "Reading.md": [occurrence("wikilink", "Poe 2021")],
        },
        {
          resolvedLinks: {
            "Reading.md": { "Literature/Poe 2021.md": 1 },
            "Chore.md": { "Other.md": 1 },
          },
          filters: filters({ citationConnectedOnly: true }),
        },
      ),
    );

    expect([...additions.survivingPaths!]).toEqual([
      "Literature/Doe 2024.md",
      "Literature/Poe 2021.md",
      "Literature/Poe 2021 reread.md",
      "Reading.md",
      "Draft.md",
    ]);
  });

  it("drops a note that only links a Literature Note without citing it", () => {
    const additions = graphCitationAdditions(
      input(
        // `Alias.md` writes `[[Poe 2021|that paper]]`, which is no Citation.
        { "Draft.md": [occurrence("citekey", "doe2024")] },
        {
          resolvedLinks: { "Alias.md": { "Literature/Poe 2021.md": 1 } },
          filters: filters({ citationConnectedOnly: true }),
        },
      ),
    );

    expect(additions.survivingPaths!.has("Alias.md")).toBe(false);
  });

  it("drops a note whose only citation is a wikilink while that row is off", () => {
    const additions = graphCitationAdditions(
      input(
        {
          "Draft.md": [occurrence("citekey", "doe2024")],
          "Reading.md": [occurrence("wikilink", "Poe 2021")],
        },
        {
          resolvedLinks: { "Reading.md": { "Literature/Poe 2021.md": 1 } },
          filters: filters({
            citationConnectedOnly: true,
            wikilinkCitations: false,
          }),
        },
      ),
    );

    expect([...additions.survivingPaths!]).toEqual([
      "Literature/Doe 2024.md",
      "Literature/Poe 2021.md",
      "Literature/Poe 2021 reread.md",
      "Draft.md",
    ]);
  });

  it("keeps a note whose citekey edge the vault already draws", () => {
    const additions = graphCitationAdditions(
      input(
        { "Draft.md": [occurrence("citekey", "doe2024")] },
        {
          resolvedLinks: { "Draft.md": { "Literature/Doe 2024.md": 1 } },
          filters: filters({
            citationConnectedOnly: true,
            wikilinkCitations: null,
          }),
        },
      ),
    );

    expect(summary(additions).resolved).toEqual({});
    expect(additions.survivingPaths!.has("Draft.md")).toBe(true);
  });
});
