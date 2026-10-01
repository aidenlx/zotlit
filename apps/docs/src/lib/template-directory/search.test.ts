import { describe, expect, it } from "vitest";

import {
  facetCounts,
  queryFromSearch,
  queryNarrows,
  searchDirectory,
  searchFromQuery,
} from "./search";
import type { IndexedEntry } from "./search";

/** A small index shaped like the Directory's first edition. */
const INDEX: readonly IndexedEntry[] = [
  {
    id: "profiles/simple-reading-note",
    kind: "profile",
    level: "ready-to-use",
    title: "Simple reading note",
    summary:
      "The title, links back to the source, the folded abstract, and your annotations in page order.",
    tasks: ["general-reading"],
    itemTypes: [],
    features: ["source-links", "abstract", "own-notes"],
    problems: [
      "I just want a literature note that works, without learning templates.",
      "My own notes get overwritten when the note updates.",
    ],
    keywords: ["starter", "persist", "Zotero Integration"],
    recommended: true,
  },
  {
    id: "profiles/colour-coded-reading-note",
    kind: "profile",
    level: "ready-to-use",
    title: "Colour-coded reading note",
    summary: "Each highlight in a callout of its Zotero color.",
    tasks: ["general-reading", "close-reading"],
    itemTypes: [],
    features: ["color-highlights", "comments"],
    problems: ["Highlight colors don't show in my note."],
    keywords: ["colorCategory", "zt-annot", "formattedAnnotations"],
    recommended: false,
  },
  {
    id: "profiles/books",
    kind: "profile",
    level: "ready-to-use",
    title: "Books",
    summary: "Book notes with publisher, place, edition, and ISBN.",
    tasks: ["reading-books"],
    itemTypes: ["book"],
    features: ["properties", "prompts"],
    problems: ["My book notes look like article notes."],
    keywords: ["monograph"],
    recommended: false,
  },
  {
    id: "partials/links-row",
    kind: "partial",
    level: "customize",
    title: "Links row",
    summary: "One line of links back to the source.",
    tasks: ["general-reading"],
    itemTypes: [],
    features: ["source-links"],
    problems: ["My note has no link back to the paper."],
    keywords: ["backlink", "DOI"],
    recommended: false,
  },
  {
    id: "properties/publisher-by-item-type",
    kind: "property",
    level: "customize",
    title: "Publisher by item type",
    summary: "One publisher property whose content depends on the item type.",
    tasks: ["literature-review", "reading-books"],
    itemTypes: ["book", "journalArticle", "bookSection", "thesis"],
    features: ["properties"],
    problems: ["My property shows Vol. null for a book."],
    keywords: ["venue", "journal"],
    recommended: false,
  },
];

const ids = (entries: readonly IndexedEntry[]) => entries.map(({ id }) => id);

describe("searchDirectory", () => {
  it("lists every entry for an empty query: recommended, then ready to use, then by title", () => {
    expect(ids(searchDirectory(INDEX, { text: "  ", facets: {} }))).toEqual([
      "profiles/simple-reading-note",
      "profiles/books",
      "profiles/colour-coded-reading-note",
      "partials/links-row",
      "properties/publisher-by-item-type",
    ]);
  });

  it("answers a question no entry matches word for word with the entries that match most of it", () => {
    expect(
      ids(
        searchDirectory(INDEX, {
          text: "why do updates overwrite my own notes every time",
          facets: {},
        }),
      ),
    ).toEqual(["profiles/simple-reading-note"]);
    expect(
      ids(
        searchDirectory(INDEX, { text: "quantum chromodynamics", facets: {} }),
      ),
    ).toEqual([]);
  });

  it("finds entries by a word in their title, summary, problems, or keywords", () => {
    expect(
      ids(searchDirectory(INDEX, { text: "monograph", facets: {} })),
    ).toEqual(["profiles/books"]);
    expect(ids(searchDirectory(INDEX, { text: "ISBN", facets: {} }))).toEqual([
      "profiles/books",
    ]);
    expect(
      ids(searchDirectory(INDEX, { text: "overwritten", facets: {} })),
    ).toEqual(["profiles/simple-reading-note"]);
    expect(
      ids(searchDirectory(INDEX, { text: "backlink", facets: {} })),
    ).toEqual(["partials/links-row"]);
  });

  it("understands a problem in the reader's own words, in either spelling", () => {
    expect(
      ids(searchDirectory(INDEX, { text: "colours don't show", facets: {} })),
    ).toEqual(["profiles/colour-coded-reading-note"]);
    expect(
      ids(searchDirectory(INDEX, { text: "color coded", facets: {} })),
    ).toEqual(["profiles/colour-coded-reading-note"]);
    expect(
      ids(searchDirectory(INDEX, { text: "Vol. null", facets: {} })),
    ).toEqual(["properties/publisher-by-item-type"]);
  });

  it("finds entries by ZotLit v1 and Zotero Integration words", () => {
    expect(
      ids(searchDirectory(INDEX, { text: "formattedAnnotations", facets: {} })),
    ).toEqual(["profiles/colour-coded-reading-note"]);
    expect(
      ids(searchDirectory(INDEX, { text: "zt-annot", facets: {} })),
    ).toEqual(["profiles/colour-coded-reading-note"]);
    expect(
      ids(searchDirectory(INDEX, { text: "persist", facets: {} })),
    ).toEqual(["profiles/simple-reading-note"]);
  });

  it("matches the start of a word, so a reader can type part of it", () => {
    expect(ids(searchDirectory(INDEX, { text: "publ", facets: {} }))).toEqual([
      "properties/publisher-by-item-type",
      "profiles/books",
    ]);
  });

  it("keeps the entries with any chosen value of a facet, across every chosen facet", () => {
    expect(
      ids(
        searchDirectory(INDEX, {
          text: "",
          facets: { task: ["reading-books", "close-reading"] },
        }),
      ),
    ).toEqual([
      "profiles/books",
      "profiles/colour-coded-reading-note",
      "properties/publisher-by-item-type",
    ]);
    expect(
      ids(
        searchDirectory(INDEX, {
          text: "",
          facets: {
            task: ["reading-books", "close-reading"],
            kind: ["profile"],
          },
        }),
      ),
    ).toEqual(["profiles/books", "profiles/colour-coded-reading-note"]);
    expect(
      ids(
        searchDirectory(INDEX, {
          text: "",
          facets: { level: ["customize"], feature: ["source-links"] },
        }),
      ),
    ).toEqual(["partials/links-row"]);
    expect(
      ids(
        searchDirectory(INDEX, { text: "note", facets: { kind: ["partial"] } }),
      ),
    ).toEqual(["partials/links-row"]);
  });

  it("fits an entry for any item type to every item type, after the entries made for it", () => {
    expect(
      ids(searchDirectory(INDEX, { text: "", facets: { itemType: ["book"] } })),
    ).toEqual([
      "profiles/books",
      "properties/publisher-by-item-type",
      "profiles/simple-reading-note",
      "profiles/colour-coded-reading-note",
      "partials/links-row",
    ]);
    expect(
      ids(
        searchDirectory(INDEX, { text: "", facets: { itemType: ["letter"] } }),
      ),
    ).toEqual([
      "profiles/simple-reading-note",
      "profiles/colour-coded-reading-note",
      "partials/links-row",
    ]);
  });

  it("matches a plural and its singular alike, a title match first", () => {
    expect(ids(searchDirectory(INDEX, { text: "books", facets: {} }))).toEqual([
      "profiles/books",
      "properties/publisher-by-item-type",
    ]);
    expect(
      ids(searchDirectory(INDEX, { text: "highlights", facets: {} })),
    ).toEqual(["profiles/colour-coded-reading-note"]);
  });
});

describe("the query in the page address", () => {
  it("reads the words and the chosen facet values, and ignores anything else", () => {
    expect(
      queryFromSearch({
        q: "colours don't show",
        task: "close-reading,teaching",
        kind: "profile",
        feature: 3,
        page: "2",
      }),
    ).toEqual({
      text: "colours don't show",
      facets: { task: ["close-reading", "teaching"], kind: ["profile"] },
    });
    expect(queryFromSearch({})).toEqual({ text: "", facets: {} });
    // The router reads `?q=2005` back as a number.
    expect(queryFromSearch({ q: 2005 })).toEqual({ text: "2005", facets: {} });
  });

  it("writes only what the reader chose, so an empty query leaves a bare address", () => {
    expect(
      searchFromQuery({
        text: "  et al  ",
        facets: { itemType: ["book", "thesis"], level: [] },
      }),
    ).toEqual({ q: "et al", itemType: "book,thesis" });
    expect(searchFromQuery({ text: "", facets: {} })).toEqual({});
  });

  it("narrows the Directory once the reader types a word or chooses a value", () => {
    expect(queryNarrows({ text: "", facets: {} })).toBe(false);
    expect(queryNarrows({ text: "   ", facets: { level: [] } })).toBe(false);
    expect(queryNarrows({ text: "colour", facets: {} })).toBe(true);
    expect(queryNarrows({ text: "", facets: { kind: ["profile"] } })).toBe(
      true,
    );
  });
});

describe("facetCounts", () => {
  const OPTIONS = {
    task: ["general-reading", "close-reading", "reading-books"],
    kind: ["profile", "partial", "property"],
    itemType: ["book", "letter"],
    feature: ["source-links", "properties"],
    level: ["ready-to-use", "customize"],
  };

  it("counts, for each value, the entries a reader would see with it chosen beside the other facets", () => {
    const counts = facetCounts(
      INDEX,
      { text: "", facets: { kind: ["profile"], task: ["reading-books"] } },
      OPTIONS,
    );
    expect(counts.task).toEqual({
      "general-reading": 2,
      "close-reading": 1,
      "reading-books": 1,
    });
    expect(counts.kind).toEqual({ profile: 1, partial: 0, property: 1 });
    expect(counts.itemType).toEqual({ book: 1, letter: 0 });
  });

  it("narrows a question's best answers, so a facet never brings in weaker matches", () => {
    const question = {
      text: "why do updates overwrite my own notes every time",
      facets: { kind: ["partial"] },
    };
    expect(ids(searchDirectory(INDEX, question))).toEqual([]);
    expect(
      facetCounts(INDEX, { ...question, facets: {} }, OPTIONS).kind,
    ).toEqual({ profile: 1, partial: 0, property: 0 });
  });

  it("counts within the search results", () => {
    const counts = facetCounts(INDEX, { text: "link", facets: {} }, OPTIONS);
    expect(counts.kind).toEqual({ profile: 1, partial: 1, property: 0 });
    expect(counts.level).toEqual({ "ready-to-use": 1, customize: 1 });
  });
});
