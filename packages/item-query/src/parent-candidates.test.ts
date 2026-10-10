import { expect, it } from "vitest";

import {
  BULK_LIBRARY,
  bulkItemKey,
  openScenarioDatabase,
  SCENARIO_LIBRARIES,
  seedBulkAnnotations,
  seedBulkAttachments,
  seedBulkLibrary,
} from "@zotlit/db/test-scenario";

import { ANNOTATIONS, ATTACHMENTS, collectQuery } from ".";
import type { RunEvent } from "./test-helpers";
import { runEffect } from "./test-helpers";

// Failure modes: parent pages grow with Library size, a parent cap hides child
// matches, or child candidates cross Target Libraries. Count the reader seam.
const candidateStatements = (events: readonly RunEvent[]) =>
  events.filter(
    (event) =>
      event.type === "statement" &&
      event.statement.reader.endsWith("candidate-set"),
  );

it.each([ATTACHMENTS, ANNOTATIONS])(
  "$id reads a parent leaf in one candidate statement per Target Library",
  async (dataset) => {
    using scenario = openScenarioDatabase({ annotations: true });
    for (const filter of [
      'item.tags.contains("methods")',
      'item.collections.within("Thesis")',
      'item.indexedKey == "ART2FULL"',
    ]) {
      const query = collectQuery(dataset, {
        libraries: [SCENARIO_LIBRARIES.personal, SCENARIO_LIBRARIES.group],
        filter,
        fields: [],
      });
      const actual = await runEffect(query, {
        client: scenario.db,
        tuning: { capRatio: 1 },
      });
      const scan = await runEffect(query, {
        client: scenario.db,
        tuning: { forceScan: true },
      });
      expect(actual.exit).toEqual(scan.exit);
      expect(actual.exit._tag).toBe("Success");
      expect(candidateStatements(actual.events)).toHaveLength(2);
    }
  },
);

it("reads 100,000 tagged parents with no Attachments in one candidate statement", async () => {
  using scenario = openScenarioDatabase();
  seedBulkLibrary(scenario.sqlite, 100_000);
  const query = collectQuery(ATTACHMENTS, {
    libraries: [BULK_LIBRARY],
    filter: 'item.tags.contains("bulk")',
    fields: [],
  });
  const actual = await runEffect(query, { client: scenario.db });
  const scan = await runEffect(query, {
    client: scenario.db,
    tuning: { forceScan: true },
  });
  expect(actual.exit).toEqual(scan.exit);
  expect(actual.exit).toMatchObject({
    _tag: "Success",
    value: { returnedCount: 0 },
  });
  expect(candidateStatements(actual.events)).toHaveLength(1);
});

it("reads a Collection of 100,000 parents with 100 Annotations outside it in one candidate statement", async () => {
  using scenario = openScenarioDatabase();
  seedBulkLibrary(scenario.sqlite, 100_001);
  seedBulkAnnotations(scenario.sqlite, 100);
  const collectionID = Number(
    scenario.sqlite
      .prepare(
        "insert into collections (collectionName, libraryID, key) values ('Mass', ?, 'MASS2222')",
      )
      .run(BULK_LIBRARY.libraryID).lastInsertRowid,
  );
  scenario.sqlite
    .prepare(
      "insert into collectionItems (collectionID, itemID, orderIndex) select ?, itemID, 0 from items where libraryID = ? and key != ? and itemTypeID = (select itemTypeID from itemTypesCombined where typeName = 'journalArticle')",
    )
    .run(collectionID, BULK_LIBRARY.libraryID, bulkItemKey(0));
  const query = collectQuery(ANNOTATIONS, {
    libraries: [BULK_LIBRARY],
    filter: 'item.collections.within("Mass")',
    fields: [],
  });
  const actual = await runEffect(query, { client: scenario.db });
  const scan = await runEffect(query, {
    client: scenario.db,
    tuning: { forceScan: true },
  });
  expect(actual.exit).toEqual(scan.exit);
  expect(actual.exit).toMatchObject({
    _tag: "Success",
    value: { returnedCount: 0 },
  });
  expect(candidateStatements(actual.events)).toHaveLength(1);
});

it.each([1, 1_001])(
  "keeps parent candidate statement counts fixed with %i Items",
  async (count) => {
    using scenario = openScenarioDatabase();
    seedBulkLibrary(scenario.sqlite, count);
    seedBulkAttachments(scenario.sqlite, count);
    seedBulkAnnotations(scenario.sqlite, 100);
    for (const dataset of [ATTACHMENTS, ANNOTATIONS]) {
      for (const filter of [
        'item.tags.contains("bulk")',
        'item.collections.within("Bulk collection")',
        `item.indexedKey == "${bulkItemKey(0)}g2718"`,
      ]) {
        const query = collectQuery(dataset, {
          libraries: [BULK_LIBRARY],
          filter,
          fields: [],
        });
        const actual = await runEffect(query, {
          client: scenario.db,
          tuning: { capRatio: 1 },
        });
        const scan = await runEffect(query, {
          client: scenario.db,
          tuning: { forceScan: true },
        });
        expect(actual.exit).toEqual(scan.exit);
        expect(actual.exit._tag).toBe("Success");
        expect(candidateStatements(actual.events)).toHaveLength(1);
      }
    }
  },
);
