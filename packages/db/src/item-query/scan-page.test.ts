import { Cause, Effect, Exit } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import { openScenarioDatabase, SCENARIO_LIBRARIES } from "@/test-scenario";
import type { ScenarioDatabase } from "@/test-scenario";

import {
  checkLayout,
  ItemQueryDatabase,
  ItemQueryDatabaseError,
  readScanPage,
  SCAN_PAGE_SIZE,
} from ".";
import type { ScanRow } from ".";

let scenario: ScenarioDatabase | undefined;

afterEach(() => {
  scenario?.close();
  scenario = undefined;
});

function run<A, E>(effect: Effect.Effect<A, E, ItemQueryDatabase>) {
  scenario ??= openScenarioDatabase();
  return Effect.runSyncExit(
    Effect.provideService(effect, ItemQueryDatabase, { client: scenario.db }),
  );
}

function runOk<A, E>(effect: Effect.Effect<A, E, ItemQueryDatabase>): A {
  const exit = run(effect);
  if (exit._tag === "Failure") throw new Error(String(exit.cause));
  return exit.value;
}

const { personal, group } = SCENARIO_LIBRARIES;

describe("readScanPage", () => {
  it("reads the live top-level Items of one Library in key order", () => {
    const rows = runOk(
      readScanPage({ libraryID: personal.libraryID, afterKey: null }),
    );

    expect(rows.map((row) => row.key)).toEqual([
      "ALS2CNFL",
      "ART2FULL",
      "BK2MNTH2",
      "CHP2YEAR",
      "CNF2TEXT",
      "RPT2NDTE",
      "TIE2AAAA",
      "TIE2BBBB",
      "TIE2CCCC",
      "UNI2CDE2",
    ]);
    expect(
      runOk(readScanPage({ libraryID: group.libraryID, afterKey: null })).map(
        (row) => row.key,
      ),
    ).toEqual(["ART2FULL", "GRP2BK22"]);
  });

  it("gives each row its item type and its two timestamps", () => {
    const rows = runOk(
      readScanPage({
        libraryID: personal.libraryID,
        afterKey: "ALS2CNFL",
        size: 1,
      }),
    );

    expect(rows).toEqual([
      {
        itemID: expect.any(Number),
        key: "ART2FULL",
        itemType: "journalArticle",
        dateAdded: Temporal.Instant.from("2020-03-16T09:30:00Z"),
        dateModified: Temporal.Instant.from("2024-06-01T10:00:00Z"),
      },
    ]);
  });

  it("continues after a key, so pages cover the Library without overlap", () => {
    const keys: string[] = [];
    let afterKey: string | null = null;
    for (;;) {
      const page: ScanRow[] = runOk(
        readScanPage({ libraryID: personal.libraryID, afterKey, size: 3 }),
      );
      keys.push(...page.map((row) => row.key));
      if (page.length < 3) break;
      afterKey = page.at(-1)!.key;
    }

    expect(keys).toEqual([
      "ALS2CNFL",
      "ART2FULL",
      "BK2MNTH2",
      "CHP2YEAR",
      "CNF2TEXT",
      "RPT2NDTE",
      "TIE2AAAA",
      "TIE2BBBB",
      "TIE2CCCC",
      "UNI2CDE2",
    ]);
  });

  it("reads at most 500 Items in one page, whatever size the caller asks for", () => {
    scenario = openScenarioDatabase();
    const insert = scenario.sqlite.prepare(
      "insert into items (itemTypeID, libraryID, key) select itemTypeID, ?, ? from itemTypesCombined where typeName = 'book'",
    );
    for (let i = 0; i < 600; i++) {
      insert.run(personal.libraryID, `ZZ${String(i).padStart(6, "0")}`);
    }

    expect(SCAN_PAGE_SIZE).toBe(500);
    expect(
      runOk(readScanPage({ libraryID: personal.libraryID, afterKey: null })),
    ).toHaveLength(500);
    expect(
      runOk(
        readScanPage({
          libraryID: personal.libraryID,
          afterKey: null,
          size: 10_000,
        }),
      ),
    ).toHaveLength(500);
  });

  it("fails with the tagged database error that carries the statement", () => {
    scenario = openScenarioDatabase();
    // The copy passes the layout check first, so the statement itself fails.
    runOk(checkLayout());
    scenario.sqlite.exec("alter table items rename column dateAdded to added");

    const exit = run(
      readScanPage({ libraryID: group.libraryID, afterKey: "ART2FULL" }),
    );

    if (!Exit.isFailure(exit)) throw new Error("the read did not fail.");
    const error = Cause.squash(exit.cause);
    expect(Cause.hasFails(exit.cause)).toBe(true);
    expect(error).toBeInstanceOf(ItemQueryDatabaseError);
    expect(error).toMatchObject({
      _tag: "ItemQueryDatabaseError",
      query: expect.stringMatching(/^select .+ from "items"/),
      params: expect.arrayContaining([group.libraryID, "ART2FULL", 500]),
      cause: expect.objectContaining({
        message: expect.stringContaining("dateAdded"),
      }),
    });
  });
});
