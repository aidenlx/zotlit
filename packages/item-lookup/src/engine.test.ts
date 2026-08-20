import { describe, expect, it } from "vitest";

import { USER_LIBRARY_ID } from "@zotlit/db";
import type { IndexedItem } from "@zotlit/db";

import { buildIndex, cleanQuery, searchIndex } from "./engine";
import { makeCreator as creator, makeIndexedItem as item } from "./fixtures";
import type { TokenizerOptions } from "./tokenizer";

describe("item lookup engine", () => {
  it("matches query terms across Zotero quicksearch fields", () => {
    const target = item({
      key: "A",
      title: "Senior citizen transit ID cards",
      creators: [creator("Transit", "SEPTA")],
      date: "2015-01-01",
      publicationTitle: "Agency reports",
      shortTitle: "Transit ID",
      court: "Commonwealth Court",
    });

    expect(searchItems([target], "senior septa 2015")[0]?.item.key).toBe("A");
    expect(searchItems([target], "agency")[0]?.item.key).toBe("A");
    expect(searchItems([target], "transit")[0]?.item.key).toBe("A");
    expect(searchItems([target], "commonwealth")[0]?.item.key).toBe("A");
  });

  it("requires every query token across MiniSearch and overlays", () => {
    const target = item({
      key: "A",
      title: "Smith transit memo",
      date: "2020-01-01",
    });
    const yearOnly = item({
      key: "B",
      title: "Transit memo",
      date: "2020-01-01",
    });

    const hits = searchItems([yearOnly, target], "smith 2020");

    expect(hits.map((hit) => hit.item.key)).toEqual(["A"]);
  });

  it("uses citationKey prefix evidence without breaking AND semantics", () => {
    const target = item({
      key: "A",
      title: "Other",
      citationKey: "smith2020memo",
      date: "2020-01-01",
    });
    const yearOnly = item({
      key: "B",
      title: "Other",
      date: "2020-01-01",
    });

    const hits = searchItems([yearOnly, target], "smith 2020");

    expect(hits.map((hit) => hit.item.key)).toEqual(["A"]);
  });

  it("ranks citationKey-cover hits before MiniSearch hits", () => {
    const citationKeyCover = item({
      key: "A",
      title: "Other",
      citationKey: "senior",
    });
    const miniSearchHit = item({
      key: "B",
      title: "Senior citizen transit ID cards",
    });

    const hits = searchItems([miniSearchHit, citationKeyCover], "sen");

    expect(hits.map((hit) => hit.item.key)).toEqual(["A", "B"]);
  });

  it("short-circuits exact 8-character Zotero keys after cleanup", () => {
    const target = item({
      key: "ABCD1234",
      title: "Unrelated",
    });
    const contentMatch = item({
      key: "WXYZ5678",
      title: "ABCD1234",
    });
    const hits = searchItems([contentMatch, target], "[@abcd1234]");

    expect(hits.map((hit) => hit.item.key)).toEqual(["ABCD1234"]);
  });

  it("requires every query token to match somewhere", () => {
    const target = item({
      key: "A",
      title: "Senior citizen transit ID cards",
      creators: [creator("Transit", "SEPTA")],
      date: "2015-01-01",
    });

    expect(searchItems([target], "senior nonexistent 2015")).toEqual([]);
  });

  it("returns no results for whitespace-only queries", () => {
    const target = item({
      key: "A",
      title: "Senior citizen transit ID cards",
    });
    const index = buildIndex([target], opts(), {
      libraries: [USER_LIBRARY_ID],
    });

    expect(searchIndex(index, "   ", { tokenizer: opts(), limit: 50 })).toEqual(
      [],
    );
  });

  it("breaks score ties via a mild recency bonus", () => {
    // Two near-identical hits — same fields, same matches, different ages.
    // The recency multiplier (≤1.1×) is enough to reorder when relevance ties.
    const recent = item({
      key: "A",
      title: "Senior services overview",
      dateModified: now(),
    });
    const stale = item({
      key: "B",
      title: "Senior services overview",
      dateModified: yearsAgo(3),
    });
    const hits = searchItems([stale, recent], "senior services");

    expect(hits.map((hit) => hit.item.key)).toEqual(["A", "B"]);
  });

  it("returns title highlight ranges for matched query terms", () => {
    const target = item({
      key: "A",
      title: "Senior citizen transit ID cards",
      date: "2015-01-01",
    });
    const hits = searchItems([target], "senior 2015");

    expect(hits[0]?.matches).toEqual([[0, 6]]);
  });

  it("cleans bracketed citation queries without collapsing tokens", () => {
    expect(cleanQuery("[@Smith,2020; et al.]")).toBe("Smith 2020");
    expect(cleanQuery("Smith and Doe. 2020")).toBe("Smith Doe 2020");
    expect(cleanQuery("etal Smith")).toBe("etal Smith");
  });

  it("bypasses DOI and ISBN cleanup", () => {
    const doi = "[https://doi.org/10.1234/Smith.2020]";
    const isbn = "ISBN: 978-1-4028-9462-6";

    expect(cleanQuery(doi)).toBe(doi);
    expect(cleanQuery(isbn)).toBe(isbn);
  });

  it("highlights matches across diacritic folding", () => {
    const title =
      "Estudio de la infraestructura para la bicicleta en Málaga . " +
      "Diseño , movilidad y mejoras para transformarlo en una " +
      "infraestructura útil para el usuario .";
    const target = item({
      key: "Jose2014",
      title,
    });
    const hits = searchItems([target], "util");

    expect(hits).toHaveLength(1);
    const [match] = hits[0]!.matches;
    expect(match).toBeDefined();
    const [start, end] = match!;
    expect(title.slice(start, end)).toBe("útil");
  });

  it("highlights fuzzy-matched indexed terms despite query typos", () => {
    // Regression: query `utilz` fuzzy-matches indexed `util` (from `útil`).
    // The user-typed token never appears in the title — highlight must
    // come from the matched indexed term, not from the raw query string.
    const title =
      "Estudio de la infraestructura para la bicicleta en Málaga . " +
      "Diseño , movilidad y mejoras para transformarlo en una " +
      "infraestructura útil para el usuario .";
    const target = item({
      key: "Jose2014",
      title,
    });
    const hits = searchItems([target], "utilz");

    expect(hits).toHaveLength(1);
    const [match] = hits[0]!.matches;
    expect(match).toBeDefined();
    const [start, end] = match!;
    expect(title.slice(start, end)).toBe("útil");
  });
});

/**
 * One composite corpus over several Libraries. Canonical Library order here is
 * `[1, 7, 3]` — deliberately against ascending local `libraryID` — so an
 * ordering assertion cannot pass on database row order.
 */
describe("composite index over several libraries", () => {
  const LIBRARIES = [USER_LIBRARY_ID, 7, 3];

  const composite = (items: readonly IndexedItem[]) =>
    buildIndex(items, opts(), { libraries: LIBRARIES });

  it("orders an empty search by global recency", () => {
    const index = composite([
      item({ key: "A", libraryID: 3, dateModified: "2024-01-01T00:00:00Z" }),
      item({ key: "B", libraryID: 1, dateModified: "2026-01-01T00:00:00Z" }),
      item({ key: "C", libraryID: 7, dateModified: "2025-01-01T00:00:00Z" }),
    ]);

    expect(index.items.map((entry) => entry.key)).toEqual(["B", "C", "A"]);
  });

  it("breaks equal timestamps by canonical library order, then item id", () => {
    const sameInstant = "2025-01-01T00:00:00Z";
    const index = composite([
      item({
        key: "A",
        itemID: 20,
        libraryID: 3,
        dateModified: sameInstant,
      }),
      item({
        key: "B",
        itemID: 30,
        libraryID: USER_LIBRARY_ID,
        dateModified: sameInstant,
      }),
      item({
        key: "C",
        itemID: 10,
        libraryID: USER_LIBRARY_ID,
        dateModified: sameInstant,
      }),
      item({ key: "D", itemID: 40, libraryID: 7, dateModified: sameInstant }),
    ]);

    expect(index.items.map((entry) => entry.key)).toEqual(["C", "B", "D", "A"]);
  });

  it("returns every library holding a repeated bare zotero key", () => {
    const index = composite([
      item({ key: "AAAAAAAA", itemID: 1, libraryID: 3 }),
      item({ key: "AAAAAAAA", itemID: 2, libraryID: USER_LIBRARY_ID }),
      item({ key: "BBBBBBBB", itemID: 3, libraryID: 7 }),
    ]);

    const hits = searchIndex(index, "AAAAAAAA", {
      tokenizer: opts(),
      limit: 50,
    });

    expect(hits.map((hit) => hit.item.libraryID)).toEqual([USER_LIBRARY_ID, 3]);
  });

  it("caps repeated exact key matches at the result limit", () => {
    const index = composite([
      item({ key: "AAAAAAAA", itemID: 1, libraryID: USER_LIBRARY_ID }),
      item({ key: "AAAAAAAA", itemID: 2, libraryID: 7 }),
    ]);

    expect(
      searchIndex(index, "AAAAAAAA", { tokenizer: opts(), limit: 1 }),
    ).toHaveLength(1);
  });

  it("keeps equivalent items from different libraries separate", () => {
    const index = composite([
      item({
        key: "AAAAAAAA",
        itemID: 1,
        libraryID: USER_LIBRARY_ID,
        title: "Shared study",
      }),
      item({ key: "BBBBBBBB", itemID: 2, libraryID: 7, title: "Shared study" }),
    ]);

    const hits = searchIndex(index, "shared study", {
      tokenizer: opts(),
      limit: 50,
    });

    expect(hits.map((hit) => hit.item.itemID)).toEqual([1, 2]);
  });

  it("orders tied relevance by recency, then library, then item id", () => {
    const sameInstant = "2025-01-01T00:00:00Z";
    const index = composite([
      item({
        key: "A",
        itemID: 5,
        libraryID: 3,
        title: "Shared study",
        dateModified: sameInstant,
      }),
      item({
        key: "B",
        itemID: 9,
        libraryID: USER_LIBRARY_ID,
        title: "Shared study",
        dateModified: sameInstant,
      }),
      item({
        key: "C",
        itemID: 1,
        libraryID: 7,
        title: "Shared study",
        dateModified: "2020-01-01T00:00:00Z",
      }),
    ]);

    const hits = searchIndex(index, "shared study", {
      tokenizer: opts(),
      limit: 50,
    });

    expect(hits.map((hit) => hit.item.key)).toEqual(["B", "A", "C"]);
  });
});

function searchItems(items: readonly IndexedItem[], query: string) {
  const tokenizerOpts = opts();
  const index = buildIndex(items, tokenizerOpts, {
    libraries: [USER_LIBRARY_ID],
  });
  return searchIndex(index, query, { tokenizer: tokenizerOpts, limit: 50 });
}

function opts(): TokenizerOptions {
  return {
    intl: new Intl.Segmenter(undefined, { granularity: "word" }),
  };
}

function now(): string {
  return Temporal.Now.instant().toString();
}

function yearsAgo(years: number): string {
  return Temporal.Now.instant()
    .subtract({ hours: years * 365 * 24 })
    .toString();
}
