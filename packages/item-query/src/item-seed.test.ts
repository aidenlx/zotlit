// A seed keeps what the Items filter reads: an Item from its seed matches a
// filter in memory exactly when a query with that filter returns it.
import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";

import { formatIndexedKey } from "@zotlit/db";
import type { NodeDatabaseClient } from "@zotlit/db/client/node";
import type { ItemQueryDatabase } from "@zotlit/db/item-query";
import {
  openScenarioDatabase,
  SCENARIO_LIBRARIES,
} from "@zotlit/db/test-scenario";

import { collectQuery, ITEMS, planItemFilter, queryItemFrom } from ".";
import { readQueryItemSeed } from ".";
import { runEffect, TEST_NOW } from "./test-helpers";

const CLOCK = { now: Temporal.Instant.from(TEST_NOW), timeZone: "UTC" };

describe("readQueryItemSeed", () => {
  it.each(
    Object.keys(SCENARIO_LIBRARIES) as (keyof typeof SCENARIO_LIBRARIES)[],
  )(
    "keeps every value the Items filter reads, in the %s Library",
    async (name) => {
      using scenario = openScenarioDatabase();
      const library = SCENARIO_LIBRARIES[name];
      const rows = scenario.sqlite
        .prepare("select itemID from items where libraryID = ?")
        .all(library.libraryID) as { itemID: number }[];
      const seeded = await run(
        Effect.forEach(rows, ({ itemID }) =>
          readQueryItemSeed({ itemID, ...library }),
        ),
        scenario.db,
      );
      const seeds = seeded.flatMap((seed) => (seed ? [seed] : []));
      // The Library has top-level Items, and child Items have no seed.
      expect(seeds.length).toBeGreaterThan(0);
      expect(seeds.length).toBeLessThan(rows.length);
      for (const filter of FILTERS) {
        const planned = planItemFilter(filter);
        if (!("matches" in planned)) throw new Error(planned.message);
        const inMemory = seeds
          .filter((seed) => planned.matches(queryItemFrom(seed), CLOCK))
          .map((seed) => formatIndexedKey(seed.scan.key, seed.groupID))
          .toSorted();
        const queried = await run(
          collectQuery(ITEMS, { libraries: [library], filter, fields: [] }),
          scenario.db,
        );
        expect(
          (queried.rows ?? []).map(({ indexedKey }) => indexedKey).toSorted(),
          filter,
        ).toEqual(inMemory);
      }
    },
  );
});

const FILTERS = [
  'itemType == "book"',
  'itemType != "journalArticle"',
  "tags.isEmpty()",
  "tags.length > 1",
  "collections.isEmpty()",
  "collections.length > 0",
  'title.contains("the")',
  "creators.length > 1",
  'firstAuthor.fullName.startsWith("S")',
  "date.year < 2015",
  "dateAdded < today()",
  'library == "personal"',
  "abstractNote.isEmpty()",
  "!url.isEmpty()",
];

async function run<A, E>(
  effect: Effect.Effect<A, E, ItemQueryDatabase>,
  client: NodeDatabaseClient,
): Promise<A> {
  const { exit } = await runEffect(effect, { client });
  if (!Exit.isSuccess(exit)) throw new Error(String(exit.cause));
  return exit.value;
}
