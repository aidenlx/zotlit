import { type LinkCache } from "obsidian";
import { describe, expect, it } from "vitest";

import { citationsEqual, scanCitations } from "./scan";

const KEY_A = "ABCD2345";
const KEY_B = "ZZZ99999g7";

/** Resolves a linkpath to an Indexed Key from a plain lookup table. */
function resolver(table: Record<string, string>) {
  return (linkpath: string): string | null => table[linkpath] ?? null;
}

function link(target: string, line: number, col = 0): LinkCache {
  return {
    link: target,
    original: `[[${target}]]`,
    position: {
      start: { line, col, offset: 0 },
      end: { line, col: col + target.length + 4, offset: 0 },
    },
  };
}

describe("scanCitations", () => {
  // Obsidian emits `links` in document order, so link order is the numbering
  // order — the second link cited gets the second number, not the lower line.
  it("numbers references by first occurrence in link-cache order", () => {
    const citations = scanCitations(
      [link("Roe 2025", 1), link("Doe 2024", 3)],
      resolver({ "Doe 2024": KEY_A, "Roe 2025": KEY_B }),
    );

    expect(citations.map((c) => [c.linkpath, c.refNumber])).toEqual([
      ["Roe 2025", 1],
      ["Doe 2024", 2],
    ]);
  });

  it("shares one reference number across repeated citations of a note", () => {
    const citations = scanCitations(
      [link("Doe 2024", 0), link("Roe 2025", 1), link("Doe 2024", 2)],
      resolver({ "Doe 2024": KEY_A, "Roe 2025": KEY_B }),
    );

    expect(citations).toHaveLength(2);
    expect(citations[0]).toMatchObject({
      indexedKey: KEY_A,
      linkpath: "Doe 2024",
      refNumber: 1,
    });
    expect(citations[0]!.occurrences).toHaveLength(2);
  });

  it("takes occurrence positions from the link cache", () => {
    const citations = scanCitations(
      [link("Doe 2024", 4, 12), link("Doe 2024", 9, 3)],
      resolver({ "Doe 2024": KEY_A }),
    );

    expect(citations[0]!.occurrences).toEqual([
      link("Doe 2024", 4, 12).position,
      link("Doe 2024", 9, 3).position,
    ]);
  });

  it("excludes wikilinks that are not Literature Notes", () => {
    const citations = scanCitations(
      [link("Daily/2024-01-01", 0), link("Doe 2024", 1)],
      resolver({ "Doe 2024": KEY_A }),
    );

    expect(citations.map((c) => c.linkpath)).toEqual(["Doe 2024"]);
  });

  it("resolves the linkpath without its subpath", () => {
    const citations = scanCitations(
      [link("Doe 2024#Findings", 0), link("Doe 2024#^abc123", 1)],
      resolver({ "Doe 2024": KEY_A }),
    );

    expect(citations).toHaveLength(1);
    expect(citations[0]).toMatchObject({ linkpath: "Doe 2024", refNumber: 1 });
    expect(citations[0]!.occurrences).toHaveLength(2);
  });

  it("skips links that carry no path of their own", () => {
    const citations = scanCitations(
      [link("#Findings", 0)],
      resolver({ "": KEY_A }),
    );

    expect(citations).toEqual([]);
  });

  it("groups distinct linkpaths that resolve to one Indexed Key", () => {
    const citations = scanCitations(
      [link("Notes/Doe 2024", 0), link("Doe 2024", 1)],
      resolver({ "Notes/Doe 2024": KEY_A, "Doe 2024": KEY_A }),
    );

    expect(citations).toHaveLength(1);
    expect(citations[0]).toMatchObject({
      indexedKey: KEY_A,
      linkpath: "Notes/Doe 2024",
    });
    expect(citations[0]!.occurrences).toHaveLength(2);
  });

  it("returns an empty list for a document without links", () => {
    expect(scanCitations([], resolver({}))).toEqual([]);
  });
});

describe("citationsEqual", () => {
  const table = resolver({ "Doe 2024": KEY_A, "Roe 2025": KEY_B });

  it("accepts two scans of the same links", () => {
    const links = [link("Doe 2024", 0), link("Roe 2025", 1)];

    expect(
      citationsEqual(scanCitations(links, table), scanCitations(links, table)),
    ).toBe(true);
  });

  it("rejects a moved occurrence", () => {
    expect(
      citationsEqual(
        scanCitations([link("Doe 2024", 0)], table),
        scanCitations([link("Doe 2024", 1)], table),
      ),
    ).toBe(false);
  });

  it("rejects an added citation", () => {
    expect(
      citationsEqual(
        scanCitations([link("Doe 2024", 0)], table),
        scanCitations([link("Doe 2024", 0), link("Roe 2025", 1)], table),
      ),
    ).toBe(false);
  });
});
