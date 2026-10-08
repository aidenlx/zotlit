import { Effect, Exit, Fiber, Stream } from "effect";
import { describe, expect, it } from "vitest";

import { USER_LIBRARY_ID } from "@zotlit/db";
import type { IndexedItem } from "@zotlit/db";

import { buildEngineIndex, cleanQuery, searchEngineIndex } from "./engine";
import type { ItemHit } from "./engine";
import { makeCreator as creator, makeIndexedItem as item } from "./fixtures";
import { layerSegmenterNone } from "./segmenter";

describe("item search engine", () => {
  it("matches query terms across every indexed field", async () => {
    const target = item({
      key: "A",
      title: "Senior citizen transit ID cards",
      creators: [creator("Transit", "SEPTA")],
      date: "2015-01-01",
      publicationTitle: "Agency reports",
      shortTitle: "Transit ID",
      court: "Commonwealth Court",
    });

    for (const query of [
      "senior septa 2015",
      "agency",
      "transit",
      "commonwealth",
    ]) {
      expect(keys(await search([target], query))).toEqual(["A"]);
    }
  });

  it("requires every query token to match some field", async () => {
    const target = item({
      key: "A",
      title: "Smith transit memo",
      date: "2020",
    });
    const yearOnly = item({ key: "B", title: "Transit memo", date: "2020" });
    const keyAndYear = item({
      key: "C",
      title: "Other",
      citationKey: "smith2020memo",
      date: "2020-01-01",
    });

    expect(
      keys(await search([yearOnly, target, keyAndYear], "smith 2020")),
    ).toEqual(expect.arrayContaining(["A", "C"]));
    expect(
      keys(await search([yearOnly, target, keyAndYear], "smith 2020")),
    ).not.toContain("B");
    expect(await search([target], "senior nonexistent")).toEqual([]);
  });

  it("answers a whitespace-only query with the empty-query order", async () => {
    const older = item({ key: "A", dateModified: "2024-01-01T00:00:00Z" });
    const newer = item({ key: "B", dateModified: "2025-01-01T00:00:00Z" });

    expect(keys(await search([older, newer], "   "))).toEqual(["B", "A"]);
  });

  it("answers nothing when cleanup leaves no search words", async () => {
    const target = item({ key: "A", title: "Senior citizen" });

    expect(await search([target], "[@ ; et al.]")).toEqual([]);
  });

  it("ranks citation keys that start with the whole query first, shortest first", async () => {
    const titleHit = item({
      key: "A",
      title: "Senior citizen transit ID cards",
      dateModified: "2026-01-01T00:00:00Z",
    });
    const longKey = item({
      key: "B",
      title: "Other",
      citationKey: "seniorlong",
    });
    const shortKey = item({ key: "C", title: "Other", citationKey: "senior" });

    expect(keys(await search([titleHit, longKey, shortKey], "sen"))).toEqual([
      "C",
      "B",
      "A",
    ]);
    // `seniorl` still fuzzy-matches `senior`; only the key it prefixes leads.
    expect(
      keys(await search([titleHit, longKey, shortKey], "@seniorl"))[0],
    ).toBe("B");
  });

  it("finds a citation key by its whole-query prefix across word boundaries", async () => {
    // Word segmentation cuts this key into 研究 / 生命 / 起源 / 2020, so no
    // single word of it starts with 研究生.
    const target = item({
      key: "A",
      title: "Other",
      citationKey: "研究生命起源2020",
    });
    const titleHit = item({
      key: "B",
      title: "研究生 survey",
      dateModified: "2026-01-01T00:00:00Z",
    });

    expect(keys(await search([titleHit, target], "研究生"))[0]).toBe("A");
  });

  it("answers a bare Zotero key after cleanup with that Item alone", async () => {
    const target = item({ key: "ABCD1234", title: "Unrelated" });
    const contentMatch = item({ key: "WXYZ5678", title: "ABCD1234" });

    expect(keys(await search([contentMatch, target], "[@abcd1234]"))).toEqual([
      "ABCD1234",
    ]);
  });

  it("returns title highlight ranges for matched query terms", async () => {
    const target = item({
      key: "A",
      title: "Senior citizen transit ID cards",
      date: "2015-01-01",
    });

    expect((await search([target], "senior 2015"))[0]?.matches).toEqual([
      [0, 6],
    ]);
  });

  it.each(["util", "utilz"])(
    "highlights the original glyphs across diacritic folding (%s)",
    async (query) => {
      // `utilz` fuzzy-matches the indexed `util` (from `útil`); the highlight
      // comes from the matched indexed term, not from the typed one.
      const title =
        "Estudio de la infraestructura para la bicicleta en Málaga . " +
        "Diseño , movilidad y mejoras para transformarlo en una " +
        "infraestructura útil para el usuario .";
      const hits = await search([item({ key: "A", title })], query);

      expect(hits).toHaveLength(1);
      expect(
        hits[0]!.matches.map(([start, end]) => title.slice(start, end)),
      ).toEqual(["útil"]);
    },
  );

  it("cleans bracketed citation queries without collapsing tokens", () => {
    expect(cleanQuery("[@Smith,2020; et al.]")).toBe("Smith 2020");
    expect(cleanQuery("Smith and Doe. 2020")).toBe("Smith Doe 2020");
    expect(cleanQuery("etal Smith")).toBe("etal Smith");
  });

  it("bypasses cleanup for DOI and ISBN queries", () => {
    const doi = "[https://doi.org/10.1234/Smith.2020]";
    const isbn = "ISBN: 978-1-4028-9462-6";

    expect(cleanQuery(doi)).toBe(doi);
    expect(cleanQuery(isbn)).toBe(isbn);
  });
});

/**
 * One composite corpus over several Libraries. Canonical Library order here is
 * `[1, 7, 3]`, against ascending local `libraryID`, so an ordering assertion
 * cannot pass on database row order.
 */
describe("composite index over several libraries", () => {
  const libraries = [USER_LIBRARY_ID, 7, 3];
  const sameInstant = "2025-01-01T00:00:00Z";

  it("answers the empty query in global order, truncated to the limit", async () => {
    const items = [
      item({ key: "A", libraryID: 3, dateModified: "2024-01-01T00:00:00Z" }),
      item({ key: "B", libraryID: 1, dateModified: "2026-01-01T00:00:00Z" }),
      item({ key: "C", libraryID: 7, dateModified: "2025-01-01T00:00:00Z" }),
    ];

    expect(keys(await search(items, "", { libraries }))).toEqual([
      "B",
      "C",
      "A",
    ]);
    expect(keys(await search(items, "", { libraries, limit: 2 }))).toEqual([
      "B",
      "C",
    ]);
  });

  it("breaks equal timestamps by canonical library order, then item id", async () => {
    const items = [
      item({ key: "A", itemID: 20, libraryID: 3, dateModified: sameInstant }),
      item({ key: "B", itemID: 30, libraryID: 1, dateModified: sameInstant }),
      item({ key: "C", itemID: 10, libraryID: 1, dateModified: sameInstant }),
      item({ key: "D", itemID: 40, libraryID: 7, dateModified: sameInstant }),
    ];

    expect(keys(await search(items, "", { libraries }))).toEqual([
      "C",
      "B",
      "D",
      "A",
    ]);
  });

  it("returns every library holding a bare zotero key, capped at the limit", async () => {
    const items = [
      item({ key: "AAAAAAAA", itemID: 1, libraryID: 3 }),
      item({ key: "AAAAAAAA", itemID: 2, libraryID: USER_LIBRARY_ID }),
      item({ key: "BBBBBBBB", itemID: 3, libraryID: 7 }),
    ];

    const hits = await search(items, "AAAAAAAA", { libraries });
    expect(hits.map((hit) => hit.libraryID)).toEqual([USER_LIBRARY_ID, 3]);
    expect(
      await search(items, "AAAAAAAA", { libraries, limit: 1 }),
    ).toHaveLength(1);
  });

  it("orders tied relevance by recency, then library, then item id", async () => {
    const items = [
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
    ];

    expect(keys(await search(items, "shared study", { libraries }))).toEqual([
      "B",
      "A",
      "C",
    ]);
  });
});

describe("interruption", () => {
  const titled = (count: number) =>
    Array.from({ length: count }, (_, i) =>
      item({ key: `K${i}`, itemID: i + 1, title: `Senior study ${i}` }),
    );

  it("ends a search fiber interrupted mid-query", async () => {
    const exit = await Effect.gen(function* () {
      const index = yield* buildEngineIndex(Stream.make(titled(10)), {
        libraries: LIBRARIES,
      });
      // Started inline, the fiber runs until the search's first interruption
      // point; a search with none would finish before the interrupt lands.
      const fiber = yield* Effect.forkChild(
        searchEngineIndex(index, "senior", 50),
        { startImmediately: true },
      );
      yield* Fiber.interrupt(fiber);
      return yield* Fiber.await(fiber);
    }).pipe(Effect.provide(layerSegmenterNone), Effect.runPromise);

    expect(Exit.hasInterrupts(exit)).toBe(true);
  });

  it("ends a build interrupted between slices with no index", async () => {
    const slices = Stream.fromIterable([titled(5), titled(5), titled(5)]);
    const exit = await Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(
        buildEngineIndex(slices, { libraries: LIBRARIES }),
        { startImmediately: true },
      );
      yield* Fiber.interrupt(fiber);
      return yield* Fiber.await(fiber);
    }).pipe(Effect.provide(layerSegmenterNone), Effect.runPromise);

    expect(Exit.hasInterrupts(exit)).toBe(true);
  });
});

const LIBRARIES = [USER_LIBRARY_ID];

function search(
  items: readonly IndexedItem[],
  query: string,
  options: { limit?: number; libraries?: readonly number[] } = {},
): Promise<readonly ItemHit[]> {
  return Effect.gen(function* () {
    const index = yield* buildEngineIndex(Stream.make(items), {
      libraries: options.libraries ?? LIBRARIES,
    });
    return yield* searchEngineIndex(index, query, options.limit ?? 50);
  }).pipe(Effect.provide(layerSegmenterNone), Effect.runPromise);
}

function keys(hits: readonly ItemHit[]): string[] {
  return hits.map((hit) => hit.indexedKey);
}
