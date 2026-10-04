import { Cause, Effect, Exit } from "effect";
import type { SQLInputValue } from "node:sqlite";
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

/**
 * Record the Item IDs that the field-value statement binds. Only that statement
 * reads its field list through `json_each`.
 */
function recordHydratedItemIDs(database: ScenarioDatabase): () => number[] {
  const ids: number[] = [];
  const { sqlite } = database;
  const prepare = sqlite.prepare.bind(sqlite);
  sqlite.prepare = (sql: string) => {
    const statement = prepare(sql);
    if (!sql.includes("json_each")) return statement;
    const all = statement.all.bind(statement);
    statement.all = ((...params: SQLInputValue[]) => {
      for (const param of params)
        if (typeof param === "number") ids.push(param);
      return all(...params);
    }) as typeof statement.all;
    return statement;
  };
  return () => ids;
}

function itemIDsOf(database: ScenarioDatabase, keys: string[]): number[] {
  return keys.map(
    (key) =>
      (
        database.sqlite
          .prepare("select itemID from items where key = ? and libraryID = 1")
          .get(key) as { itemID: number }
      ).itemID,
  );
}

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
  it("projects the item type, title, date, and modification time when the caller names no fields", async () => {
    const found = await result({ library: personal, limit: 1 });

    expect(found.rows).toEqual([
      {
        indexedKey: "ART2FULL",
        values: {
          itemType: "journalArticle",
          title: "Exact Matching in Literature Review",
          date: {
            kind: "date",
            value: Temporal.PlainDate.from("2020-03-15"),
            year: 2020,
            month: 3,
            day: 15,
            text: null,
            raw: "2020-03-15 2020-03-15",
          },
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

/** The `values` of each row by Indexed Key. */
const valuesByKey = (found: QueryResult) =>
  Object.fromEntries(found.rows.map((row) => [row.indexedKey, row.values]));

describe("queryItems Projection Paths", () => {
  it("projects full, partial, text, and missing dates as structured values", async () => {
    const found = await result({
      library: personal,
      fields: ["date", "date.year", "date.month", "date.day", "date.raw"],
    });
    const values = valuesByKey(found);

    expect(values["BK2MNTH2"]).toEqual({
      date: {
        kind: "yearMonth",
        value: Temporal.PlainYearMonth.from("2019-11"),
        year: 2019,
        month: 11,
        day: null,
        text: null,
        raw: "2019-11-00 November 2019",
      },
      "date.year": 2019,
      "date.month": 11,
      "date.day": null,
      "date.raw": "2019-11-00 November 2019",
    });
    expect(values["CHP2YEAR"]).toEqual({
      date: {
        kind: "year",
        value: null,
        year: 2018,
        month: null,
        day: null,
        text: null,
        raw: "2018-00-00 2018",
      },
      "date.year": 2018,
      "date.month": null,
      "date.day": null,
      "date.raw": "2018-00-00 2018",
    });
    expect(values["CNF2TEXT"]).toEqual({
      date: {
        kind: "text",
        value: null,
        year: null,
        month: null,
        day: null,
        text: "forthcoming",
        raw: "0000-00-00 forthcoming",
      },
      "date.year": null,
      "date.month": null,
      "date.day": null,
      "date.raw": "0000-00-00 forthcoming",
    });
    expect(values["RPT2NDTE"]).toEqual({
      date: null,
      "date.year": null,
      "date.month": null,
      "date.day": null,
      "date.raw": null,
    });
  });

  it("resolves an alias conflict to the type-specific field and keeps the custom field apart", async () => {
    const found = await result({
      library: personal,
      fields: [
        "publicationTitle",
        "bookTitle",
        'custom["publicationTitle"]',
        'custom["title"]',
        "title",
      ],
    });

    expect(valuesByKey(found)["ALS2CNFL"]).toEqual({
      publicationTitle: "Type-Specific Host",
      bookTitle: "Type-Specific Host",
      'custom["publicationTitle"]': "Custom Host",
      'custom["title"]': null,
      title: "Alias Conflict",
    });
    expect(valuesByKey(found)["ART2FULL"]).toEqual({
      publicationTitle: "Journal of Testing",
      bookTitle: null,
      'custom["publicationTitle"]': null,
      'custom["title"]': "Custom Title Value",
      title: "Exact Matching in Literature Review",
    });
  });

  it("resolves a base field through the type-specific field of each item type", async () => {
    const found = await result({
      library: personal,
      fields: ["publicationTitle", "publisher", "institution"],
    });
    const values = valuesByKey(found);

    expect(values["CHP2YEAR"]).toEqual({
      publicationTitle: "Handbook of Methods",
      publisher: "Sage",
      institution: null,
    });
    expect(values["CNF2TEXT"]).toMatchObject({
      publicationTitle: "Proceedings of Testing",
    });
    expect(values["RPT2NDTE"]).toEqual({
      publicationTitle: null,
      publisher: "Lab Institute",
      institution: "Lab Institute",
    });
  });

  it("gives a field value as a string whether SQLite stores it as text or as a number", async () => {
    const found = await result({ library: personal, fields: ["volume"] });
    const values = valuesByKey(found);

    expect(values["TIE2AAAA"]).toEqual({ volume: "12" });
    expect(values["TIE2BBBB"]).toEqual({ volume: "12" });
    expect(values["TIE2CCCC"]).toEqual({ volume: null });
  });

  it("reaches custom fields by exact source name, in bracket or dotted form", async () => {
    const found = await result({
      library: personal,
      fields: ['custom["review.status"]', "custom.mood", "custom"],
    });
    const values = valuesByKey(found);

    expect(values["ART2FULL"]).toEqual({
      'custom["review.status"]': "done",
      "custom.mood": "calm",
      custom: {
        "review.status": "done",
        mood: "calm",
        title: "Custom Title Value",
        publicationTitle: null,
      },
    });
    expect(values["BK2MNTH2"]).toMatchObject({
      'custom["review.status"]': "",
      "custom.mood": null,
    });
    expect(values["RPT2NDTE"]).toEqual({
      'custom["review.status"]': null,
      "custom.mood": null,
      custom: {
        "review.status": null,
        mood: null,
        title: null,
        publicationTitle: null,
      },
    });
  });

  it("puts every requested path in every row, with null for a missing value", async () => {
    const found = await result({
      library: personal,
      fields: ["title", "DOI", "date.year"],
    });

    for (const row of found.rows) {
      expect(Object.keys(row.values)).toEqual(["title", "DOI", "date.year"]);
    }
    expect(valuesByKey(found)["TIE2CCCC"]).toEqual({
      title: null,
      DOI: null,
      "date.year": 2021,
    });
  });

  it("hydrates the projection only for the rows a limited query returns", async () => {
    scenario = openScenarioDatabase();
    const hydratedIDs = recordHydratedItemIDs(scenario);

    const found = await result({
      library: personal,
      fields: ["title"],
      limit: 2,
    });

    expect(keys(found)).toEqual(["ART2FULL", "UNI2CDE2"]);
    const byNumber = (a: number, b: number) => a - b;
    expect(hydratedIDs().toSorted(byNumber)).toEqual(
      itemIDsOf(scenario, ["ART2FULL", "UNI2CDE2"]).toSorted(byNumber),
    );
  });

  it("reads Items of a Library larger than one hydrate chunk", async () => {
    scenario = openScenarioDatabase();
    const insertItem = scenario.sqlite.prepare(
      "insert into items (itemTypeID, libraryID, key, dateModified) select itemTypeID, ?, ?, '2000-01-01 00:00:00' from itemTypesCombined where typeName = 'book'",
    );
    const insertTitle = scenario.sqlite.prepare(
      "insert into itemData (itemID, fieldID, valueID) select ?, fieldID, (select valueID from itemDataValues where value = 'Lab Report') from fieldsCombined where fieldName = 'title' and custom = 0",
    );
    for (let i = 0; i < 600; i++) {
      const { lastInsertRowid } = insertItem.run(
        personal.libraryID,
        `ZZ${String(i).padStart(6, "0")}`,
      );
      insertTitle.run(lastInsertRowid);
    }

    const found = await result({ library: personal, fields: ["title"] });

    expect(found.returnedCount).toBe(610);
    expect(
      found.rows.filter((row) => row.values["title"] === "Lab Report"),
    ).toHaveLength(601);
  });
});

describe("queryItems normalized request", () => {
  it("reports the defaults it applied", async () => {
    const found = await result({ library: personal });

    expect(found.query).toEqual({
      fields: ["itemType", "title", "date", "dateModified"],
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

  it.each([
    ["date.", "invalid-path"],
    ["custom[review]", "invalid-path"],
    ['custom["unterminated]', "invalid-path"],
    ["", "invalid-path"],
    ["[0]", "unknown-field"],
    ["mood", "unknown-field"],
    ["Title", "unknown-field"],
    ["date.century", "unknown-path"],
    ["title.length", "unknown-path"],
    ["date[0]", "unknown-path"],
    ["custom[0]", "unknown-path"],
  ])(
    "fails the path %j with ItemQueryError before it reads the database",
    async (path, code) => {
      const error = await failure(
        { library: personal, fields: ["title", path] },
        false,
      );

      expect(error).toMatchObject({
        _tag: "ItemQueryError",
        code,
        location: { argument: "fields", index: 1 },
      });
    },
  );

  it("fails a custom field that the source does not define", async () => {
    const error = await failure({
      library: personal,
      fields: ['custom["Review.Status"]'],
    });

    expect(error).toMatchObject({
      _tag: "ItemQueryError",
      code: "unknown-field",
      location: { argument: "fields", index: 0 },
      message: expect.stringContaining("Review.Status"),
      hint: expect.stringContaining("review.status"),
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
