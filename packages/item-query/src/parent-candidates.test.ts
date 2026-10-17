import { configureSync, resetSync } from "@logtape/logtape";
import type { LogRecord } from "@logtape/logtape";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import { SCAN_PAGE_SIZE } from "@zotlit/db/item-query";
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
import { PRODUCTION_TUNING } from "./tuning";

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

/** The properties of each plan record the candidate pass logged. */
const planRecords = () =>
  logs
    .filter((record) => "plan" in record.properties)
    .map((record) => record.properties);

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
// The first bulk Item holds ATT22222 and BULKPDF2. The update below moves the
// Annotations after ANN22255 (index 3 * 33 + 3 = 102) to ATT22223 of the second
// Item, so indexes 0 to 102 stay on BULKPDF2.
it.each([
  { dataset: ATTACHMENTS, returnedCount: 2 },
  { dataset: ANNOTATIONS, returnedCount: 103 },
])(
  "$dataset.id keeps a selective Parent Record leaf on candidates in a large Library",
  async ({ dataset, returnedCount }) => {
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
    expect(planRecords()).toMatchObject([{ plan: "candidates", reason: null }]);
    const scan = await runEffect(query, {
      client: scenario.db,
      tuning: { forceScan: true },
    });
    expect(actual.exit).toEqual(scan.exit);
    expect(actual.exit).toMatchObject({
      _tag: "Success",
      value: { returnedCount },
    });
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

// Each filter selects the personal ART2FULL alone: ALS2CNFL also carries
// "methods" but has no children, and CHP2YEAR below Thesis has none. ART2FULL
// holds 4 live Attachments (PDF2LINK, PDF2LIVE, URL2LIVE, WEB2LIVE) and 12 live
// Annotations, 6 on PDF2LIVE and 6 on PDF2LINK.
it.each([
  { dataset: ATTACHMENTS, returnedCount: 4 },
  { dataset: ANNOTATIONS, returnedCount: 12 },
])(
  "$dataset.id reads matching parents and children in each Target Library",
  async ({ dataset, returnedCount }) => {
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
      expect(actual.exit).toMatchObject({
        _tag: "Success",
        value: { returnedCount },
      });
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
    // Each filter selects the first Item, which also holds BULKPDF2 and its
    // 100 Annotations; every fifth Item is in the Bulk collection.
    for (const [filter, parents] of [
      ['item.tags.contains("bulk")', count],
      ['item.collections.within("Bulk collection")', Math.ceil(count / 5)],
      [`item.indexedKey == "${bulkItemKey(0)}g2718"`, 1],
    ] as const) {
      for (const [dataset, returnedCount] of [
        [ATTACHMENTS, parents + 1],
        [ANNOTATIONS, 100],
      ] as const) {
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
        expect(actual.exit).toMatchObject({
          _tag: "Success",
          value: { returnedCount },
        });
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
    expect(planRecords()).toMatchObject([
      { plan: "scan", reason: "parent-page-budget-exhausted" },
    ]);
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
    // The read stops one row past the parent page budget.
    const budget = PRODUCTION_TUNING.relationPageBudget * SCAN_PAGE_SIZE;
    const rowCounts = statements.flatMap((event) =>
      event.type === "statement" ? [event.statement.rows.length] : [],
    );
    expect(rowCounts).toHaveLength(1);
    expect(rowCounts[0]).toBeLessThanOrEqual(budget + 1);
  },
  // Seeds and reads 10,000 records; the default 5000 ms limit fails on CI runners.
  20_000,
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
  expect(planRecords()).toMatchObject([{ plan: "candidates", reason: null }]);
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
