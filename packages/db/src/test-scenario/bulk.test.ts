import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import {
  ItemQueryDatabase,
  readCandidateSet,
  readHydrateChunk,
  readFieldVocabulary,
  readLibraryRowCount,
  readScanPage,
} from "@/item-query";

import {
  BULK_FIFTH_TAG,
  BULK_LIBRARY,
  BULK_TAG,
  bulkItemKey,
  openScenarioDatabase,
  SCENARIO_LIBRARIES,
  seedBulkLibrary,
} from ".";
import type { ScenarioDatabase } from ".";

let scenario: ScenarioDatabase | undefined;

afterEach(() => {
  scenario?.close();
  scenario = undefined;
});

function read<A, E>(effect: Effect.Effect<A, E, ItemQueryDatabase>): A {
  return Effect.runSync(
    Effect.provideService(effect, ItemQueryDatabase, { client: scenario!.db }),
  );
}

describe("seedBulkLibrary", () => {
  it("adds one Library of top-level Items in key order, with titles and Tags", () => {
    scenario = openScenarioDatabase();
    seedBulkLibrary(scenario.sqlite, 12);
    const { libraryID } = BULK_LIBRARY;

    const page = read(readScanPage({ libraryID, afterKey: null }));
    const tagged = (name: string) =>
      read(
        readCandidateSet({
          libraryID,
          leaf: { kind: "tag", name },
          limit: 100,
        }),
      );
    const hydrated = read(
      Effect.gen(function* () {
        return yield* readHydrateChunk({
          vocabulary: yield* readFieldVocabulary(),
          itemIDs: page.map((row) => row.itemID),
          fields: { builtIn: ["title"], custom: [] },
        });
      }),
    );

    expect(read(readLibraryRowCount(libraryID))).toBe(12);
    expect(page.map((row) => row.key)).toEqual(
      Array.from({ length: 12 }, (_, index) => bulkItemKey(index)),
    );
    expect(page[0]!.key).toBe("BLK22222");
    expect(hydrated.get(page[11]!.itemID)!.fields.get("title")).toBe(
      "Bulk item 00011",
    );
    expect(tagged(BULK_TAG)).toHaveLength(12);
    expect(tagged(BULK_FIFTH_TAG)).toEqual(
      [0, 5, 10].map((index) => page[index]!.itemID),
    );
  });

  it("leaves the scenario Libraries as they are", () => {
    scenario = openScenarioDatabase();
    const before = read(
      readLibraryRowCount(SCENARIO_LIBRARIES.personal.libraryID),
    );

    seedBulkLibrary(scenario.sqlite, 12);

    expect(
      read(readLibraryRowCount(SCENARIO_LIBRARIES.personal.libraryID)),
    ).toBe(before);
  });
});
