import { relations } from "@drizzle/relations";
import { drizzle } from "drizzle-orm/node-sqlite";
import { Cause, Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";

import { openScenarioDatabase, SCENARIO_LIBRARIES } from "@/test-scenario";
import type { ScenarioDatabase } from "@/test-scenario";

import {
  ItemQueryDatabase,
  ItemQueryDatabaseError,
  readScanPage,
  readAttachmentScanPage,
  readAnnotationScanPage,
  readUniverseRows,
  SCAN_PAGE_SIZE,
} from ".";
import type { ScanRow } from ".";
import { checkLayout } from "./database";

function run<A, E>(
  scenario: ScenarioDatabase,
  effect: Effect.Effect<A, E, ItemQueryDatabase>,
) {
  return Effect.runSyncExit(
    Effect.provideService(effect, ItemQueryDatabase, { client: scenario.db }),
  );
}

function runOk<A, E>(
  scenario: ScenarioDatabase,
  effect: Effect.Effect<A, E, ItemQueryDatabase>,
): A {
  const exit = run(scenario, effect);
  if (exit._tag === "Failure") throw new Error(String(exit.cause));
  return exit.value;
}

const { personal, group } = SCENARIO_LIBRARIES;

describe("readScanPage", () => {
  it("reads the live top-level Items of one Library in Item ID order", () => {
    using scenario = openScenarioDatabase();
    const rows = runOk(
      scenario,
      readScanPage({ libraryID: personal.libraryID, afterItemID: 0 }),
    );

    expect(rows.map((row) => row.key)).toEqual([
      "ART2FULL",
      "BK2MNTH2",
      "CHP2YEAR",
      "CNF2TEXT",
      "RPT2NDTE",
      "ALS2CNFL",
      "UNI2CDE2",
      "TIE2AAAA",
      "TIE2BBBB",
      "TIE2CCCC",
    ]);
    expect(
      runOk(
        scenario,
        readScanPage({ libraryID: group.libraryID, afterItemID: 0 }),
      ).map((row) => row.key),
    ).toEqual(["ART2FULL", "GRP2BK22"]);
  });

  it("gives each row its item type and its two timestamps", () => {
    using scenario = openScenarioDatabase();
    const rows = runOk(
      scenario,
      readScanPage({
        libraryID: personal.libraryID,
        afterItemID: 0,
        size: 1,
      }),
    );

    expect(rows).toEqual([
      {
        itemID: expect.any(Number),
        key: "ART2FULL",
        itemType: "journalArticle",
        dateAdded: Temporal.Instant.from("2020-03-16T09:30:00Z")
          .epochMilliseconds,
        dateModified: Temporal.Instant.from("2024-06-01T10:00:00Z")
          .epochMilliseconds,
      },
    ]);
  });

  it("continues after an Item ID, so pages cover the Library without overlap", () => {
    using scenario = openScenarioDatabase();
    const keys: string[] = [];
    let afterItemID = 0;
    for (;;) {
      const page: ScanRow[] = runOk(
        scenario,
        readScanPage({ libraryID: personal.libraryID, afterItemID, size: 3 }),
      );
      keys.push(...page.map((row) => row.key));
      if (page.length < 3) break;
      afterItemID = page.at(-1)!.itemID;
    }

    expect(keys).toEqual([
      "ART2FULL",
      "BK2MNTH2",
      "CHP2YEAR",
      "CNF2TEXT",
      "RPT2NDTE",
      "ALS2CNFL",
      "UNI2CDE2",
      "TIE2AAAA",
      "TIE2BBBB",
      "TIE2CCCC",
    ]);
  });

  it("reads at most 500 Items in one page, whatever size the caller asks for", () => {
    using scenario = openScenarioDatabase();
    const insert = scenario.sqlite.prepare(
      "insert into items (itemTypeID, libraryID, key) select itemTypeID, ?, ? from itemTypesCombined where typeName = 'book'",
    );
    for (let i = 0; i < 600; i++) {
      insert.run(personal.libraryID, `ZZ${String(i).padStart(6, "0")}`);
    }

    expect(SCAN_PAGE_SIZE).toBe(500);
    expect(
      runOk(
        scenario,
        readScanPage({ libraryID: personal.libraryID, afterItemID: 0 }),
      ),
    ).toHaveLength(500);
    expect(
      runOk(
        scenario,
        readScanPage({
          libraryID: personal.libraryID,
          afterItemID: 0,
          size: 10_000,
        }),
      ),
    ).toHaveLength(500);
  });

  it("fails with the tagged database error that carries the statement", () => {
    using scenario = openScenarioDatabase();
    // The copy passes the layout check first, so the statement itself fails.
    runOk(scenario, checkLayout());
    scenario.sqlite.exec("alter table items rename column dateAdded to added");

    const exit = run(
      scenario,
      readScanPage({ libraryID: group.libraryID, afterItemID: 1 }),
    );

    if (!Exit.isFailure(exit)) throw new Error("the read did not fail.");
    const error = Cause.squash(exit.cause);
    expect(Cause.hasFails(exit.cause)).toBe(true);
    expect(error).toBeInstanceOf(ItemQueryDatabaseError);
    expect(error).toMatchObject({
      _tag: "ItemQueryDatabaseError",
      query: expect.stringMatching(/^select .+ from "items"/),
      params: expect.arrayContaining([group.libraryID, 1, 500]),
      cause: expect.objectContaining({
        message: expect.stringContaining("dateAdded"),
      }),
    });
  });
});

describe("readUniverseRows", () => {
  /** The ID of the `items` row with a key in a Library. */
  function idOf(
    scenario: ScenarioDatabase,
    key: string,
    library: { libraryID: number } = personal,
  ) {
    return (
      scenario.sqlite
        .prepare("select itemID from items where key = ? and libraryID = ?")
        .get(key, library.libraryID) as { itemID: number }
    ).itemID;
  }

  it("keeps the IDs that are live top-level Items of the Target Library, as scan rows in Item ID order", () => {
    using scenario = openScenarioDatabase();
    const rows = runOk(
      scenario,
      readUniverseRows({
        libraryID: personal.libraryID,
        itemIDs: [
          idOf(scenario, "UNI2CDE2"),
          // A trashed Item, an Attachment, a Child Note, an Annotation, an Item
          // of the other Library, and an ID that no row has.
          idOf(scenario, "TRS2SHED"),
          idOf(scenario, "PDF2LIVE"),
          idOf(scenario, "NTE2CHLD"),
          idOf(scenario, "ANN2HGHT"),
          idOf(scenario, "GRP2BK22", group),
          987_654,
          idOf(scenario, "ART2FULL"),
        ],
      }),
    );

    expect(rows).toEqual([
      {
        itemID: idOf(scenario, "ART2FULL"),
        key: "ART2FULL",
        itemType: "journalArticle",
        dateAdded: Temporal.Instant.from("2020-03-16T09:30:00Z")
          .epochMilliseconds,
        dateModified: Temporal.Instant.from("2024-06-01T10:00:00Z")
          .epochMilliseconds,
      },
      expect.objectContaining({
        itemID: idOf(scenario, "UNI2CDE2"),
        key: "UNI2CDE2",
      }),
    ]);
  });

  it("gives the same row as the scan for each Item", () => {
    using scenario = openScenarioDatabase();
    const scanned = runOk(
      scenario,
      readScanPage({ libraryID: personal.libraryID, afterItemID: 0 }),
    );

    expect(
      runOk(
        scenario,
        readUniverseRows({
          libraryID: personal.libraryID,
          itemIDs: scanned.map((row) => row.itemID).toReversed(),
        }),
      ),
    ).toEqual(scanned);
  });

  it("gives one row for an ID that the chunk names twice, and no row for no IDs", () => {
    using scenario = openScenarioDatabase();
    const id = idOf(scenario, "ART2FULL", group);

    expect(
      runOk(
        scenario,
        readUniverseRows({ libraryID: group.libraryID, itemIDs: [id, id] }),
      ).map((row) => row.key),
    ).toEqual(["ART2FULL"]);
    expect(
      runOk(
        scenario,
        readUniverseRows({ libraryID: group.libraryID, itemIDs: [] }),
      ),
    ).toEqual([]);
  });

  it("takes at most 500 IDs in one chunk", () => {
    using scenario = openScenarioDatabase();
    const id = idOf(scenario, "ART2FULL");

    expect(
      runOk(
        scenario,
        readUniverseRows({
          libraryID: personal.libraryID,
          itemIDs: Array.from({ length: 500 }, (_, i) => id + i * 1000),
        }),
      ).map((row) => row.key),
    ).toEqual(["ART2FULL"]);
    const exit = run(
      scenario,
      readUniverseRows({
        libraryID: personal.libraryID,
        itemIDs: Array.from({ length: 501 }, (_, i) => i),
      }),
    );
    if (!Exit.isFailure(exit)) throw new Error("the read did not fail.");
    expect(Cause.hasDies(exit.cause)).toBe(true);
    expect(Cause.squash(exit.cause)).toBeInstanceOf(RangeError);
  });
});

// Failure mode: the Library index makes each Item ID page sort in a temporary B-tree.
it.each([
  ["Items", readScanPage],
  ["Attachments", readAttachmentScanPage],
  ["Annotations", readAnnotationScanPage],
] as const)("scans %s without a temporary ORDER BY B-tree", (_, readPage) => {
  using scenario = openScenarioDatabase({ annotations: true });
  const queries: { sql: string; params: unknown[] }[] = [];
  scenario.db = drizzle({
    client: scenario.sqlite,
    relations,
    logger: {
      logQuery(sql, params) {
        queries.push({ sql, params });
      },
    },
  });
  runOk(scenario, readPage({ libraryID: personal.libraryID, afterItemID: 0 }));
  const query = queries.at(-1)!;
  const details = scenario.sqlite
    .prepare(`EXPLAIN QUERY PLAN ${query.sql}`)
    .all(...(query.params as (string | number)[]))
    .map((row) => row.detail)
    .join("\n");
  expect(details).not.toContain("TEMP B-TREE");
});
