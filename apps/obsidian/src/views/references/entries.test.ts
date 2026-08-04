import { describe, expect, it } from "vitest";

import { type Citation } from "@/services/citation-scan/service";

import { buildReferenceEntries, type ReferenceSource } from "./entries";

function citation(
  indexedKey: string,
  refNumber: number,
  lines: readonly number[] = [refNumber],
): Citation {
  return {
    indexedKey,
    linkpath: `notes/${indexedKey}`,
    refNumber,
    occurrences: lines.map((line) => ({ line, col: 0 })),
  };
}

function source(indexedKey: string, id: string): ReferenceSource {
  return {
    csl: { id, type: "book", title: `Title of ${indexedKey}` },
    summary: `Rivers (2020): Title of ${indexedKey}`,
    itemKey: indexedKey,
    itemID: 1,
    groupID: null,
  };
}

describe("buildReferenceEntries", () => {
  it("keeps document order and reference numbers when the engine renders in another order", () => {
    const citations = [citation("ZEBRA001", 1), citation("ALPHA002", 2)];
    const sources = new Map([
      ["ZEBRA001", source("ZEBRA001", "ref-zebra")],
      ["ALPHA002", source("ALPHA002", "ref-alpha")],
    ]);
    // Alphabetical, as an author-name bibliography style sorts it.
    const rendered = new Map([
      ["ref-alpha", "<span>Alpha</span>"],
      ["ref-zebra", "<span>Zebra</span>"],
    ]);

    expect(buildReferenceEntries(citations, sources, rendered)).toStrictEqual([
      {
        indexedKey: "ZEBRA001",
        linkpath: "notes/ZEBRA001",
        refNumber: 1,
        occurrences: [{ line: 1, col: 0 }],
        kind: "rendered",
        source: sources.get("ZEBRA001"),
        html: "<span>Zebra</span>",
      },
      {
        indexedKey: "ALPHA002",
        linkpath: "notes/ALPHA002",
        refNumber: 2,
        occurrences: [{ line: 2, col: 0 }],
        kind: "rendered",
        source: sources.get("ALPHA002"),
        html: "<span>Alpha</span>",
      },
    ]);
  });

  it("falls back to the minimal reference list when nothing rendered the entries", () => {
    const citations = [citation("BOOK0001", 1)];
    const sources = new Map([["BOOK0001", source("BOOK0001", "ref-book")]]);

    expect(buildReferenceEntries(citations, sources)).toMatchObject([
      {
        kind: "summary",
        source: { summary: "Rivers (2020): Title of BOOK0001" },
      },
    ]);
  });

  it("falls back per entry when the engine rendered only some of them", () => {
    const citations = [citation("BOOK0001", 1), citation("BOOK0002", 2)];
    const sources = new Map([
      ["BOOK0001", source("BOOK0001", "ref-one")],
      ["BOOK0002", source("BOOK0002", "ref-two")],
    ]);
    const rendered = new Map([["ref-one", "<span>One</span>"]]);

    expect(
      buildReferenceEntries(citations, sources, rendered).map((e) => e.kind),
    ).toStrictEqual(["rendered", "summary"]);
  });

  it("keeps a citation whose Item the database no longer holds, in place", () => {
    const citations = [
      citation("GONE0001", 1),
      citation("BOOK0002", 2, [3, 7]),
    ];
    const sources = new Map([["BOOK0002", source("BOOK0002", "ref-two")]]);

    expect(buildReferenceEntries(citations, sources)).toStrictEqual([
      {
        indexedKey: "GONE0001",
        linkpath: "notes/GONE0001",
        refNumber: 1,
        occurrences: [{ line: 1, col: 0 }],
        kind: "missing",
      },
      {
        indexedKey: "BOOK0002",
        linkpath: "notes/BOOK0002",
        refNumber: 2,
        occurrences: [
          { line: 3, col: 0 },
          { line: 7, col: 0 },
        ],
        kind: "summary",
        source: sources.get("BOOK0002"),
      },
    ]);
  });
});
