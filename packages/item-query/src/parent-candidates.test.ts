import { configureSync, resetSync } from "@logtape/logtape";
import type { LogRecord } from "@logtape/logtape";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

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

const logs: LogRecord[] = [];
beforeEach(() => {
  logs.length = 0;
});
beforeAll(() =>
  configureSync({
    sinks: { capture: (record) => logs.push(record) },
    loggers: [
      {
        category: ["zotlit", "item-query"],
        sinks: ["capture"],
        lowestLevel: "debug",
      },
      { category: ["logtape", "meta"], sinks: [], lowestLevel: "error" },
    ],
  }),
);
afterAll(() => resetSync());

// Failure modes: parent pages grow with Library size, a parent cap hides child
// matches, or child candidates cross Target Libraries. Count the reader seam.
const candidateStatements = (events: readonly RunEvent[]) =>
  events.filter(
    (event) =>
      event.type === "statement" &&
      event.statement.reader.endsWith("candidate-set"),
  );

// Failure modes: unrelated children consume a selective leaf's work budget,
// and a partial candidate set loses the selected parent's later children.
it.each([ATTACHMENTS, ANNOTATIONS])(
  "$id keeps a selective Parent Record leaf on candidates in a large Library",
  async (dataset) => {
    using scenario = openScenarioDatabase();
    seedBulkLibrary(scenario.sqlite, 5_001);
    seedBulkAttachments(scenario.sqlite, 5_001);
    seedBulkAnnotations(scenario.sqlite, 10_000);
    scenario.sqlite.exec(
      `update itemAnnotations set parentItemID = (select itemID from items where key = 'ATT22223') where itemID in (select itemID from items where key > 'ANN22255' and libraryID = 3)`,
    );
    const query = collectQuery(dataset, {
      libraries: [BULK_LIBRARY],
      filter: `item.key == "${bulkItemKey(0)}"`,
      fields: [],
      sort: [],
    });
    const actual = await runEffect(query, {
      client: scenario.db,
      tuning: { capRatio: 1 },
    });
    expect(logs.at(-1)?.properties).toMatchObject({
      plan: "candidates",
      reason: null,
    });
    const scan = await runEffect(query, {
      client: scenario.db,
      tuning: { forceScan: true },
    });
    expect(actual.exit).toEqual(scan.exit);
    expect(actual.exit._tag).toBe("Success");
    expect(candidateStatements(actual.events).length).toBeLessThanOrEqual(3);
    expect(
      actual.events.some(
        (event) =>
          event.type === "statement" &&
          event.statement.reader.endsWith("scan-page"),
      ),
    ).toBe(false);
  },
);

it.each([ATTACHMENTS, ANNOTATIONS])(
  "$id reads matching parents and children in each Target Library",
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
      expect(candidateStatements(actual.events).length).toBeLessThanOrEqual(4);
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
  "bounds parent candidate statements with %i Items",
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
        expect(candidateStatements(actual.events).length).toBeLessThanOrEqual(
          4,
        );
      }
    }
  },
);

// Failure modes: a dominant Parent Record leaf expands in one long statement,
// or a partial page result hides later matching children.
it.each([ATTACHMENTS, ANNOTATIONS])(
  "$id bounds a dominant Parent Record candidate read",
  async (dataset) => {
    using scenario = openScenarioDatabase();
    seedBulkLibrary(scenario.sqlite, 10_000);
    seedBulkAttachments(scenario.sqlite, 10_000);
    seedBulkAnnotations(scenario.sqlite, 10_000);
    const query = collectQuery(dataset, {
      libraries: [BULK_LIBRARY],
      filter: 'item.tags.contains("bulk")',
      fields: [],
      sort: [],
    });
    const actual = await runEffect(query, {
      client: scenario.db,
      tuning: { capRatio: 1 },
    });
    expect(logs.at(-1)?.properties).toMatchObject({
      plan: "scan",
      reason: "parent-page-budget-exhausted",
    });
    const scan = await runEffect(query, {
      client: scenario.db,
      tuning: { forceScan: true },
    });
    expect(actual.exit).toEqual(scan.exit);
    expect(actual.exit._tag).toBe("Success");
    const statements = candidateStatements(actual.events);
    expect(statements).toHaveLength(1);
    expect(
      actual.events.some(
        (event) =>
          event.type === "statement" &&
          event.statement.reader.endsWith("scan-page"),
      ),
    ).toBe(true);
    for (const event of statements) {
      if (event.type === "statement")
        expect(event.statement.rows.length).toBeLessThanOrEqual(4001);
    }
  },
);

// Failure mode: children of another Library make a complete candidate set fall back.
it("keeps other-Library children outside the Parent Record budget", async () => {
  using scenario = openScenarioDatabase();
  seedBulkLibrary(scenario.sqlite, 4_000);
  seedBulkAttachments(scenario.sqlite, 4_000);
  const query = collectQuery(ATTACHMENTS, {
    libraries: [BULK_LIBRARY],
    filter: `item.key == "${bulkItemKey(0)}"`,
    fields: [],
    sort: [],
  });
  scenario.sqlite
    .prepare(
      "update itemAttachments set parentItemID = null where itemID in (select itemID from items where libraryID = 3 and key >= ? and key < 'ATU')",
    )
    .run(`ATT${bulkItemKey(2000).slice(3)}`);
  scenario.sqlite.exec(
    "update items set libraryID = 1 where itemID in (select itemID from itemAttachments where parentItemID is null) and libraryID = 3",
  );
  const actual = await runEffect(query, { client: scenario.db });
  expect(logs.at(-1)?.properties).toMatchObject({
    plan: "candidates",
    reason: null,
  });
  const scan = await runEffect(query, {
    client: scenario.db,
    tuning: { forceScan: true },
  });
  expect(actual.exit).toEqual(scan.exit);
  expect(actual.exit).toMatchObject({
    _tag: "Success",
    value: { returnedCount: 1 },
  });
  expect(candidateStatements(actual.events)).toHaveLength(2);
});
