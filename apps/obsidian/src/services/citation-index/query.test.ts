import { describe, expect, it } from "vitest";

import { groupCitations, type ResolvedNote } from "./query";
import { type CitationOccurrence } from "./scan";

const KEY_A = "ABCD2345";
const KEY_B = "ZZZ99999g7";

/** Resolves either syntax's raw text through one plain lookup table. */
function resolver(table: Record<string, ResolvedNote>) {
  return (occurrence: CitationOccurrence): ResolvedNote | null =>
    table[occurrence.raw] ?? null;
}

function note(indexedKey: string, linkpath: string): ResolvedNote {
  return { indexedKey, linkpath };
}

function occurrence(
  kind: CitationOccurrence["kind"],
  raw: string,
  offset: number,
): CitationOccurrence {
  return {
    kind,
    raw,
    position: {
      start: { line: 0, col: offset, offset },
      end: { line: 0, col: offset + raw.length, offset: offset + raw.length },
    },
  };
}

const citekey = (raw: string, offset: number) =>
  occurrence("citekey", raw, offset);
const wikilink = (raw: string, offset: number) =>
  occurrence("wikilink", raw, offset);

describe("groupCitations", () => {
  it("numbers citations by first occurrence in document order", () => {
    const citations = groupCitations(
      [wikilink("Roe 2025", 10), citekey("doe2024", 40)],
      resolver({
        "Roe 2025": note(KEY_B, "Roe 2025"),
        doe2024: note(KEY_A, "Doe 2024.md"),
      }),
    );

    expect(citations.map((c) => [c.linkpath, c.refNumber])).toEqual([
      ["Roe 2025", 1],
      ["Doe 2024.md", 2],
    ]);
  });

  it("shares one reference number across repeated citations of an Item", () => {
    const citations = groupCitations(
      [citekey("doe2024", 0), wikilink("Roe 2025", 20), citekey("doe2024", 40)],
      resolver({
        doe2024: note(KEY_A, "Doe 2024.md"),
        "Roe 2025": note(KEY_B, "Roe 2025"),
      }),
    );

    expect(citations).toHaveLength(2);
    expect(citations[0]).toMatchObject({ indexedKey: KEY_A, refNumber: 1 });
    expect(citations[0]!.occurrences).toHaveLength(2);
  });

  it("collapses both syntaxes of one Item into a single citation", () => {
    const citations = groupCitations(
      [citekey("doe2024", 0), wikilink("Doe 2024", 20)],
      resolver({
        doe2024: note(KEY_A, "Doe 2024.md"),
        "Doe 2024": note(KEY_A, "Doe 2024"),
      }),
    );

    expect(citations).toHaveLength(1);
    expect(citations[0]!.occurrences.map((o) => o.kind)).toEqual([
      "citekey",
      "wikilink",
    ]);
  });

  it("groups distinct linkpaths that resolve to one Indexed Key", () => {
    const citations = groupCitations(
      [wikilink("Notes/Doe 2024", 0), wikilink("Doe 2024", 20)],
      resolver({
        "Notes/Doe 2024": note(KEY_A, "Notes/Doe 2024"),
        "Doe 2024": note(KEY_A, "Doe 2024"),
      }),
    );

    expect(citations).toHaveLength(1);
    expect(citations[0]).toMatchObject({ linkpath: "Notes/Doe 2024" });
    expect(citations[0]!.occurrences).toHaveLength(2);
  });

  it("keeps the occurrences of one citation in document order", () => {
    const occurrences = [citekey("doe2024", 4), citekey("doe2024", 30)];

    const [citation] = groupCitations(
      occurrences,
      resolver({ doe2024: note(KEY_A, "Doe 2024.md") }),
    );

    expect(citation!.occurrences).toEqual(occurrences);
  });

  it("drops a wikilink that points at an ordinary note", () => {
    const citations = groupCitations(
      [wikilink("Daily/2024-01-01", 0), wikilink("Doe 2024", 20)],
      resolver({ "Doe 2024": note(KEY_A, "Doe 2024") }),
    );

    expect(citations.map((c) => c.linkpath)).toEqual(["Doe 2024"]);
  });

  // Pandoc warns on an undefined citation rather than dropping it, so a typo
  // stays visible instead of vanishing from the reference list.
  it("keeps a citekey no Literature Note carries as its own citation", () => {
    const citations = groupCitations(
      [citekey("doe2024", 0), citekey("typo2024", 20), citekey("typo2024", 40)],
      resolver({ doe2024: note(KEY_A, "Doe 2024.md") }),
    );

    expect(citations).toHaveLength(2);
    expect(citations[1]).toMatchObject({
      indexedKey: null,
      linkpath: null,
      refNumber: 2,
    });
    expect(citations[1]!.occurrences).toHaveLength(2);
  });

  it("keeps two unresolved citekeys apart", () => {
    const citations = groupCitations(
      [citekey("typo2024", 0), citekey("typo2025", 20)],
      resolver({}),
    );

    expect(citations.map((c) => c.refNumber)).toEqual([1, 2]);
  });

  it("returns an empty list for a document without occurrences", () => {
    expect(groupCitations([], resolver({}))).toEqual([]);
  });
});
