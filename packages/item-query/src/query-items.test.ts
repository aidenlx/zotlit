import { Cause, Effect, Exit } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import { ItemQueryDatabase } from "@zotlit/db/item-query";
import {
  openScenarioDatabase,
  SCENARIO_LIBRARIES,
} from "@zotlit/db/test-scenario";
import type { ScenarioDatabase } from "@zotlit/db/test-scenario";

import { ItemQueryError, ItemQueryScheduler, queryItems } from ".";
import type { ItemQueryRequest, QueryResult } from ".";
import { runEffect } from "./test-helpers";

let scenario: ScenarioDatabase | undefined;

afterEach(() => {
  scenario?.close();
  scenario = undefined;
});

const { personal, group } = SCENARIO_LIBRARIES;

function run(request: ItemQueryRequest) {
  scenario ??= openScenarioDatabase();
  return runEffect(queryItems(request), { client: scenario.db });
}

async function result(request: ItemQueryRequest): Promise<QueryResult> {
  const { exit } = await run(request);
  if (!Exit.isSuccess(exit)) throw new Error(String(exit.cause));
  return exit.value;
}

/** The typed failure of a run; a defect or an interruption fails the test. */
async function failure(request: ItemQueryRequest, client = true) {
  if (client) scenario ??= openScenarioDatabase();
  const { exit } = await runEffect(queryItems(request), {
    client: client ? scenario?.db : undefined,
  });
  if (!Exit.isFailure(exit)) throw new Error("the query did not fail.");
  const error = Cause.findErrorOption(exit.cause);
  if (error._tag === "None") throw new Error(String(exit.cause));
  return error.value;
}

const keys = (found: QueryResult) => found.rows.map((row) => row.indexedKey);

/** The personal Library, most recently modified first, ties in key order. */
const PERSONAL_BY_MODIFIED = [
  "ART2FULL",
  "UNI2CDE2",
  "ALS2CNFL",
  "TIE2AAAA",
  "TIE2BBBB",
  "TIE2CCCC",
  "RPT2NDTE",
  "CHP2YEAR",
  "BK2MNTH2",
  "CNF2TEXT",
];

describe("queryItems without a filter", () => {
  it("returns the live top-level Items of the Library, most recently modified first", async () => {
    const found = await result({ library: personal });

    expect(keys(found)).toEqual(PERSONAL_BY_MODIFIED);
    expect(found.returnedCount).toBe(10);
    expect(found.truncated).toBe(false);
  });

  it("keeps the two Libraries apart and gives group Items their group Indexed Key", async () => {
    const found = await result({ library: group });

    expect(keys(found)).toEqual(["ART2FULLg4815", "GRP2BK22g4815"]);
  });

  it("reads a Library that is larger than one scan page", async () => {
    scenario = openScenarioDatabase();
    const insert = scenario.sqlite.prepare(
      "insert into items (itemTypeID, libraryID, key, dateModified) select itemTypeID, ?, ?, ? from itemTypesCombined where typeName = 'book'",
    );
    // 1,200 more Items, modified one second apart from 2025-01-01 on, with keys
    // in the reverse order of their modification times.
    const start = Temporal.Instant.from("2025-01-01T00:00:00Z");
    for (let i = 0; i < 1200; i++) {
      const modified = start.add({ seconds: i }).toString().slice(0, 19);
      insert.run(
        personal.libraryID,
        `ZZ${String(9999 - i).padStart(6, "0")}`,
        modified.replace("T", " "),
      );
    }

    const all = await result({ library: personal });
    const newest = await result({ library: personal, limit: 2 });

    expect(all.returnedCount).toBe(1210);
    expect(keys(all).slice(0, 2)).toEqual(["ZZ008800", "ZZ008801"]);
    expect(keys(all).slice(-10)).toEqual(PERSONAL_BY_MODIFIED);
    expect(keys(newest)).toEqual(["ZZ008800", "ZZ008801"]);
    expect(newest.truncated).toBe(true);
  });
});

describe("queryItems with a limit", () => {
  it("returns the first rows of the order and reports that more Items match", async () => {
    const found = await result({ library: personal, limit: 3 });

    expect(keys(found)).toEqual(PERSONAL_BY_MODIFIED.slice(0, 3));
    expect(found.returnedCount).toBe(3);
    expect(found.truncated).toBe(true);
  });

  it("breaks a tie inside the limit by Indexed Key", async () => {
    const found = await result({ library: personal, limit: 5 });

    expect(keys(found).slice(3)).toEqual(["TIE2AAAA", "TIE2BBBB"]);
    expect(found.truncated).toBe(true);
  });

  it("is not truncated when exactly `limit` Items match", async () => {
    const found = await result({ library: personal, limit: 10 });

    expect(keys(found)).toEqual(PERSONAL_BY_MODIFIED);
    expect(found.truncated).toBe(false);
  });

  it("returns every match when the limit is above the match count", async () => {
    const found = await result({ library: personal, limit: 11 });

    expect(found.returnedCount).toBe(10);
    expect(found.truncated).toBe(false);
  });

  it.each([undefined, null])(
    "returns every match with the limit %s",
    async (limit) => {
      const found = await result({ library: personal, limit });

      expect(found.returnedCount).toBe(10);
      expect(found.truncated).toBe(false);
    },
  );
});

describe("queryItems projection", () => {
  it("projects the item type and the modification time when the caller names no fields", async () => {
    const found = await result({ library: personal, limit: 1 });

    expect(found.rows).toEqual([
      {
        indexedKey: "ART2FULL",
        values: {
          itemType: "journalArticle",
          dateModified: Temporal.Instant.from("2024-06-01T10:00:00Z"),
        },
      },
    ]);
  });

  it("returns identity-only rows for an empty field list", async () => {
    const found = await result({ library: personal, fields: [], limit: 2 });

    expect(found.rows).toEqual([
      { indexedKey: "ART2FULL", values: {} },
      { indexedKey: "UNI2CDE2", values: {} },
    ]);
  });

  it("puts every requested field in each row", async () => {
    const found = await result({
      library: group,
      fields: ["dateAdded", "itemType"],
    });

    expect(found.rows.map((row) => row.values)).toEqual([
      {
        dateAdded: Temporal.Instant.from("2020-04-01T09:00:00Z"),
        itemType: "journalArticle",
      },
      {
        dateAdded: Temporal.Instant.from("2022-03-01T09:00:00Z"),
        itemType: "book",
      },
    ]);
  });
});

describe("queryItems normalized request", () => {
  it("reports the defaults it applied", async () => {
    const found = await result({ library: personal });

    expect(found.query).toEqual({
      fields: ["itemType", "dateModified"],
      sort: [{ field: "dateModified", direction: "desc" }],
      limit: null,
    });
  });

  it("reports the fields and the limit the caller gave", async () => {
    const found = await result({
      library: personal,
      fields: ["dateAdded"],
      limit: 4,
    });

    expect(found.query).toEqual({
      fields: ["dateAdded"],
      sort: [{ field: "dateModified", direction: "desc" }],
      limit: 4,
    });
  });
});

describe("queryItems failures", () => {
  it("fails an unknown field with ItemQueryError before it reads the database", async () => {
    const error = await failure(
      { library: personal, fields: ["itemType", "noSuchField"] },
      false,
    );

    expect(error).toBeInstanceOf(ItemQueryError);
    expect(error).toMatchObject({
      _tag: "ItemQueryError",
      code: "unknown-field",
      location: { argument: "fields", index: 1 },
      message: expect.stringContaining("noSuchField"),
      hint: expect.stringContaining("dateModified"),
    });
  });

  it.each([0, -1, 1.5, Number.NaN])(
    "fails the limit %s with ItemQueryError",
    async (limit) => {
      const error = await failure({ library: personal, limit }, false);

      expect(error).toMatchObject({
        _tag: "ItemQueryError",
        code: "invalid-limit",
        location: { argument: "limit" },
      });
    },
  );

  it("fails with the tagged database error when a statement fails", async () => {
    scenario = openScenarioDatabase();
    scenario.sqlite.exec("drop table deletedItems");

    const error = await failure({ library: personal });

    expect(error).toMatchObject({
      _tag: "ItemQueryDatabaseError",
      query: expect.stringContaining("deletedItems"),
      cause: expect.objectContaining({
        message: expect.stringContaining("deletedItems"),
      }),
    });
  });
});

describe("queryItems under a scheduler", () => {
  it("pauses between operations and gives the result of the exported scheduler", async () => {
    scenario = openScenarioDatabase();
    const request: ItemQueryRequest = { library: personal, limit: 4 };

    const stepped = await run(request);
    const production = await Effect.runPromiseExit(
      Effect.provideService(queryItems(request), ItemQueryDatabase, {
        client: scenario.db,
      }),
      { scheduler: new ItemQueryScheduler() },
    );

    expect(stepped.pauses).toBeGreaterThan(0);
    expect(Exit.isSuccess(production)).toBe(true);
    expect(stepped.exit).toEqual(production);
  });
});
