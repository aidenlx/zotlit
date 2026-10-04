import { Cause, Clock, Effect, Exit } from "effect";
import type { SQLInputValue } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import {
  checkLayout,
  ItemQueryDatabase,
  ItemQueryLayoutError,
} from "@zotlit/db/item-query";
import {
  openScenarioDatabase,
  SCENARIO_LIBRARIES,
} from "@zotlit/db/test-scenario";
import type { ScenarioDatabase } from "@zotlit/db/test-scenario";

import { ItemQueryError, ItemQueryScheduler, queryItems } from ".";
import type { ItemQueryRequest, QueryResult } from ".";
import { runEffect } from "./test-helpers";
import type { RunOptions } from "./test-helpers";

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
 * Record the Item IDs that the statements whose SQL contains `marker` bind.
 * Only the field-value statement reads its field list through `json_each`.
 */
function recordHydratedItemIDs(
  database: ScenarioDatabase,
  marker = "json_each",
): () => number[] {
  const ids: number[] = [];
  const { sqlite } = database;
  const prepare = sqlite.prepare.bind(sqlite);
  sqlite.prepare = (sql: string) => {
    const statement = prepare(sql);
    if (!sql.includes(marker)) return statement;
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

/** Store a built-in field value on a personal Item of the scenario. */
function setField(
  database: ScenarioDatabase,
  key: string,
  [field, value]: readonly [string, string],
): void {
  const { sqlite } = database;
  sqlite
    .prepare("insert or ignore into itemDataValues (value) values (?)")
    .run(value);
  sqlite
    .prepare(
      "insert or replace into itemData (itemID, fieldID, valueID) select i.itemID, f.fieldID, v.valueID from items i, fieldsCombined f, itemDataValues v where i.key = ? and i.libraryID = 1 and f.fieldName = ? and f.custom = 0 and v.value = ?",
    )
    .run(key, field, value);
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
  it("projects the item type, title, creators, date, and modification time when the caller names no fields", async () => {
    const found = await result({ library: personal, limit: 1 });

    expect(found.rows).toEqual([
      {
        indexedKey: "ART2FULL",
        values: {
          itemType: "journalArticle",
          title: "Exact Matching in Literature Review",
          creators: [
            {
              family: "Lovelace",
              given: "Ada",
              literal: null,
              role: "author",
              fullName: "Ada Lovelace",
            },
            {
              family: "",
              given: "",
              literal: "World Health Organization",
              role: "author",
              fullName: "World Health Organization",
            },
          ],
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

describe("queryItems relation lists", () => {
  it("projects Creators in Zotero's creator order, one element for each row", async () => {
    const found = await result({ library: personal, fields: ["creators"] });
    const values = valuesByKey(found);

    // The same person as author and as editor gives two elements.
    expect(values["BK2MNTH2"]).toEqual({
      creators: [
        {
          family: "Hopper",
          given: "Grace",
          literal: null,
          role: "author",
          fullName: "Grace Hopper",
        },
        {
          family: "Hopper",
          given: "Grace",
          literal: null,
          role: "editor",
          fullName: "Grace Hopper",
        },
      ],
    });
    expect(values["ART2FULL"]).toEqual({
      creators: [
        {
          family: "Lovelace",
          given: "Ada",
          literal: null,
          role: "author",
          fullName: "Ada Lovelace",
        },
        {
          family: "",
          given: "",
          literal: "World Health Organization",
          role: "author",
          fullName: "World Health Organization",
        },
      ],
    });
    expect(values["RPT2NDTE"]).toEqual({ creators: [] });
  });

  it("projects Tags in the Item Query string order, with their type", async () => {
    const found = await result({
      library: personal,
      fields: ["tags", "tags[0].name"],
    });
    const values = valuesByKey(found);

    expect(values["ART2FULL"]).toEqual({
      tags: [
        { name: "methods", type: "manual" },
        { name: "to-read", type: "manual" },
        { name: "To-Read", type: "auto" },
      ],
      "tags[0].name": "methods",
    });
    expect(values["UNI2CDE2"]?.["tags"]).toEqual([
      { name: "100%_raw\\path", type: "manual" },
      { name: "eclair", type: "manual" },
      { name: "Éclair", type: "manual" },
    ]);
    expect(values["RPT2NDTE"]).toEqual({ tags: [], "tags[0].name": null });
  });

  it("projects each live Collection as its root-first path, in the Item Query string order", async () => {
    const found = await result({
      library: personal,
      fields: ["collections", "collections[1]"],
    });
    const values = valuesByKey(found);

    expect(values["CHP2YEAR"]).toEqual({
      collections: ["Thesis", "Thesis/Methods"],
      "collections[1]": "Thesis/Methods",
    });
    // Also filed in Archive/Old, below the trashed Archive.
    expect(values["ART2FULL"]?.["collections"]).toEqual(["Thesis/Methods"]);
    // Also filed in the trashed Archive.
    expect(values["BK2MNTH2"]?.["collections"]).toEqual(["Teaching/Methods"]);
    expect(values["RPT2NDTE"]).toEqual({
      collections: [],
      "collections[1]": null,
    });
  });

  it("gives the Collection paths of the Target Library", async () => {
    const found = await result({ library: group, fields: ["collections"] });

    expect(valuesByKey(found)).toEqual({
      ART2FULLg4815: { collections: [] },
      GRP2BK22g4815: { collections: ["Methods"] },
    });
  });

  it("projects Attachment presence as true for an Item with a live Attachment", async () => {
    const found = await result({ library: personal, fields: ["attachments"] });

    expect(valuesByKey(found)["ART2FULL"]).toEqual({ attachments: true });
    expect(valuesByKey(found)["RPT2NDTE"]).toEqual({ attachments: false });
  });

  it("projects Attachment presence as false for an Item with only trashed Attachments", async () => {
    scenario = openScenarioDatabase();
    // ART2FULL keeps only its already trashed Attachment.
    scenario.sqlite.exec(
      "insert into deletedItems (itemID, dateDeleted) select itemID, '2024-01-01 00:00:00' from items where key = 'PDF2LIVE'",
    );

    const found = await result({ library: personal, fields: ["attachments"] });

    expect(valuesByKey(found)["ART2FULL"]).toEqual({ attachments: false });
  });

  it("loads each relation only for the rows a limited query returns", async () => {
    scenario = openScenarioDatabase();
    const tables = [
      "itemCreators",
      "itemTags",
      "collectionItems",
      "itemAttachments",
    ];
    const recorded = tables.map((table) =>
      recordHydratedItemIDs(scenario!, `"${table}"`),
    );

    await result({
      library: personal,
      fields: ["creators", "tags", "collections", "attachments"],
      limit: 2,
    });

    const byNumber = (a: number, b: number) => a - b;
    const returned = itemIDsOf(scenario, ["ART2FULL", "UNI2CDE2"]);
    for (const ids of recorded) {
      expect(ids().toSorted(byNumber)).toEqual(returned.toSorted(byNumber));
    }
  });

  it("loads no relation that the query does not read", async () => {
    scenario = openScenarioDatabase();
    const recorded = ["itemCreators", "itemTags", "collectionItems"].map(
      (table) => recordHydratedItemIDs(scenario!, `"${table}"`),
    );

    await result({ library: personal, fields: ["title", "attachments"] });

    for (const ids of recorded) expect(ids()).toEqual([]);
  });

  it("reaches one Creator by index, with null past the end", async () => {
    const found = await result({
      library: personal,
      fields: ["creators[0].fullName", "creators[1].role", "creators[2]"],
    });
    const values = valuesByKey(found);

    expect(values["CHP2YEAR"]).toEqual({
      "creators[0].fullName": "Alan Turing",
      "creators[1].role": "editor",
      "creators[2]": null,
    });
    expect(values["RPT2NDTE"]).toEqual({
      "creators[0].fullName": null,
      "creators[1].role": null,
      "creators[2]": null,
    });
  });
});

describe("queryItems normalized request", () => {
  it("reports the defaults it applied", async () => {
    const found = await result({ library: personal });

    expect(found.query).toEqual({
      filter: null,
      fields: ["itemType", "title", "creators", "date", "dateModified"],
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
      filter: null,
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
    // Array access does not vectorize.
    ["creators.fullName", "unknown-path"],
    ["tags.name", "unknown-path"],
    ["creators[0].name", "unknown-path"],
    ["collections[0].name", "unknown-path"],
    ["attachments[0]", "unknown-path"],
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
    // The copy passes the layout check first, so the statement itself fails.
    await runEffect(checkLayout(), { client: scenario.db });
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

describe("queryItems on the layout of the Zotero database", () => {
  function stamp(versions: { userdata: number; compatibility: number }) {
    const update = scenario!.sqlite.prepare(
      "update version set version = ? where schema = ?",
    );
    update.run(versions.userdata, "userdata");
    update.run(versions.compatibility, "compatibility");
  }

  it("fails with ItemQueryLayoutError when a copy stamped inside the supported range lacks a manifest column", async () => {
    scenario = openScenarioDatabase();
    stamp({ userdata: 129, compatibility: 9 });
    scenario.sqlite.exec('alter table "fieldsCombined" drop column "custom"');

    const error = await failure({ library: personal, fields: [] });

    expect(error).toBeInstanceOf(ItemQueryLayoutError);
    expect(error).toMatchObject({
      _tag: "ItemQueryLayoutError",
      missing: [{ table: "fieldsCombined", column: "custom" }],
      message: expect.stringContaining("Update ZotLit"),
    });
  });

  it("gives the oracle result on a copy stamped outside the supported range with the full layout", async () => {
    scenario = openScenarioDatabase();
    stamp({ userdata: 140, compatibility: 12 });

    const found = await result({ library: personal, fields: ["title"] });

    expect(keys(found)).toEqual(PERSONAL_BY_MODIFIED);
    expect(found.rows[0]!.values).toEqual({
      title: "Exact Matching in Literature Review",
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

describe("queryItems sort", () => {
  const sortedKeys = async (
    sort: ItemQueryRequest["sort"],
    limit?: number,
  ): Promise<string[]> =>
    keys(await result({ library: personal, fields: [], sort, limit }));

  it("orders by a string field in ascending order, with a missing value last and a tie in Indexed Key order", async () => {
    expect(await sortedKeys([{ field: "title", direction: "asc" }])).toEqual([
      "CHP2YEAR",
      "ALS2CNFL",
      "UNI2CDE2",
      "ART2FULL",
      "CNF2TEXT",
      "RPT2NDTE",
      "BK2MNTH2",
      "TIE2AAAA",
      "TIE2BBBB",
      "TIE2CCCC",
    ]);
  });

  it("orders in descending order, still with a missing value last and a tie in Indexed Key order", async () => {
    expect(await sortedKeys([{ field: "title", direction: "desc" }])).toEqual([
      "TIE2AAAA",
      "TIE2BBBB",
      "BK2MNTH2",
      "RPT2NDTE",
      "CNF2TEXT",
      "ART2FULL",
      "UNI2CDE2",
      "ALS2CNFL",
      "CHP2YEAR",
      "TIE2CCCC",
    ]);
  });

  it("orders a null-heavy field by the next Sortable Field inside each tie group", async () => {
    expect(
      await sortedKeys([
        { field: "volume", direction: "asc" },
        { field: "dateModified", direction: "asc" },
      ]),
    ).toEqual([
      "TIE2AAAA",
      "TIE2BBBB",
      "ART2FULL",
      "CNF2TEXT",
      "BK2MNTH2",
      "CHP2YEAR",
      "RPT2NDTE",
      "TIE2CCCC",
      "ALS2CNFL",
      "UNI2CDE2",
    ]);
  });

  it("orders the Items without a value by Indexed Key in both directions", async () => {
    const missing = [
      "ALS2CNFL",
      "BK2MNTH2",
      "CHP2YEAR",
      "CNF2TEXT",
      "RPT2NDTE",
      "TIE2CCCC",
      "UNI2CDE2",
    ];
    const valued = ["ART2FULL", "TIE2AAAA", "TIE2BBBB"];

    expect(await sortedKeys([{ field: "volume", direction: "asc" }])).toEqual([
      ...valued,
      ...missing,
    ]);
    expect(await sortedKeys([{ field: "volume", direction: "desc" }])).toEqual([
      ...valued,
      ...missing,
    ]);
  });

  it("orders by Indexed Key alone for an empty sort list", async () => {
    expect(await sortedKeys([])).toEqual(PERSONAL_BY_MODIFIED.toSorted());
  });

  it("orders a date field by the first day each date can mean, with a text date and a missing date last", async () => {
    expect(await sortedKeys([{ field: "date", direction: "asc" }])).toEqual([
      "CHP2YEAR",
      "BK2MNTH2",
      "ART2FULL",
      "TIE2AAAA",
      "TIE2BBBB",
      "TIE2CCCC",
      "ALS2CNFL",
      "UNI2CDE2",
      "CNF2TEXT",
      "RPT2NDTE",
    ]);
  });

  it("orders by a field of the scan row", async () => {
    expect(
      await sortedKeys([
        { field: "itemType", direction: "asc" },
        { field: "dateAdded", direction: "desc" },
      ]),
    ).toEqual([
      "BK2MNTH2",
      "ALS2CNFL",
      "CHP2YEAR",
      "CNF2TEXT",
      "UNI2CDE2",
      "TIE2AAAA",
      "TIE2BBBB",
      "TIE2CCCC",
      "ART2FULL",
      "RPT2NDTE",
    ]);
  });

  it("reports the sort the caller gave in the normalized request", async () => {
    const sort = [{ field: "title", direction: "desc" }] as const;
    const found = await result({ library: personal, sort, limit: 1 });

    expect(found.query.sort).toEqual(sort);
  });

  it("sorts strings in the pinned collation order: digits lexically, then letters with case and accents as the last difference", async () => {
    scenario = openScenarioDatabase();
    const { sqlite } = scenario;
    const insertItem = sqlite.prepare(
      "insert into items (itemTypeID, libraryID, key) select itemTypeID, 2, ? from itemTypesCombined where typeName = 'book'",
    );
    const insertValue = sqlite.prepare(
      "insert or ignore into itemDataValues (value) values (?)",
    );
    const insertTitle = sqlite.prepare(
      "insert into itemData (itemID, fieldID, valueID) select ?, fieldID, (select valueID from itemDataValues where value = ?) from fieldsCombined where fieldName = 'title' and custom = 0",
    );
    const titles = ["Zebra", "apple", "Éclair", "eclair", "10", "9"];
    for (const [i, title] of titles.entries()) {
      const item = insertItem.run(`CLT${i}AAAA`).lastInsertRowid;
      insertValue.run(title);
      insertTitle.run(item, title);
    }

    const found = await result({
      library: group,
      fields: ["title"],
      sort: [{ field: "title", direction: "asc" }],
    });

    expect(
      found.rows
        .map((row) => row.values["title"])
        .filter((title) => titles.includes(title as string)),
    ).toEqual(["10", "9", "apple", "eclair", "Éclair", "Zebra"]);
  });

  it("hydrates the sort field for every Item and the projection for the returned rows only", async () => {
    scenario = openScenarioDatabase();
    const { sqlite } = scenario;
    const fieldID = (name: string) =>
      (
        sqlite
          .prepare(
            "select fieldID from fieldsCombined where fieldName = ? and custom = 0",
          )
          .get(name) as { fieldID: number }
      ).fieldID;
    // The Items each field-value statement reads, by the fields it reads.
    const reads: { fieldIDs: number[]; itemIDs: number[] }[] = [];
    const prepare = sqlite.prepare.bind(sqlite);
    sqlite.prepare = (sql: string) => {
      const statement = prepare(sql);
      if (!sql.includes("json_each")) return statement;
      const all = statement.all.bind(statement);
      statement.all = ((...params: SQLInputValue[]) => {
        reads.push({
          fieldIDs: params.flatMap((param) =>
            typeof param === "string" ? (JSON.parse(param) as number[]) : [],
          ),
          itemIDs: params.filter((param) => typeof param === "number"),
        });
        return all(...params);
      }) as typeof statement.all;
      return statement;
    };

    const found = await result({
      library: personal,
      fields: ["DOI"],
      sort: [{ field: "title", direction: "asc" }],
      limit: 2,
    });

    expect(found.rows).toEqual([
      { indexedKey: "CHP2YEAR", values: { DOI: null } },
      { indexedKey: "ALS2CNFL", values: { DOI: null } },
    ]);
    const byNumber = (a: number, b: number) => a - b;
    const itemsRead = (name: string) =>
      reads
        .filter((read) => read.fieldIDs.includes(fieldID(name)))
        .flatMap((read) => read.itemIDs)
        .toSorted(byNumber);
    expect(itemsRead("title")).toEqual(
      itemIDsOf(scenario, PERSONAL_BY_MODIFIED).toSorted(byNumber),
    );
    expect(itemsRead("DOI")).toEqual(
      itemIDsOf(scenario, ["CHP2YEAR", "ALS2CNFL"]).toSorted(byNumber),
    );
  });
});

describe("queryItems sort with a limit", () => {
  const byTitle = [{ field: "title", direction: "asc" }] as const;
  const BY_TITLE = [
    "CHP2YEAR",
    "ALS2CNFL",
    "UNI2CDE2",
    "ART2FULL",
    "CNF2TEXT",
    "RPT2NDTE",
    "BK2MNTH2",
    "TIE2AAAA",
    "TIE2BBBB",
    "TIE2CCCC",
  ];

  it("returns no rows from a Library without Items", async () => {
    const found = await result({
      library: { libraryID: 9999, groupID: null },
      sort: byTitle,
      limit: 3,
    });

    expect(found).toMatchObject({
      rows: [],
      returnedCount: 0,
      truncated: false,
    });
  });

  it.each([
    ["exactly `limit` Items match", 10, false],
    ["`limit + 1` Items match", 9, true],
  ])(
    "returns the first rows of the sort when %s",
    async (_, limit, truncated) => {
      const found = await result({ library: personal, sort: byTitle, limit });

      expect(keys(found)).toEqual(BY_TITLE.slice(0, limit));
      expect(found.returnedCount).toBe(limit);
      expect(found.truncated).toBe(truncated);
    },
  );

  it("cuts a tie group at the limit in Indexed Key order", async () => {
    const found = await result({ library: personal, sort: byTitle, limit: 8 });

    expect(keys(found).slice(-2)).toEqual(["BK2MNTH2", "TIE2AAAA"]);
    expect(found.truncated).toBe(true);
  });

  it("cuts the Items without a value at the limit in Indexed Key order", async () => {
    const found = await result({
      library: personal,
      sort: [{ field: "volume", direction: "desc" }],
      limit: 5,
    });

    expect(keys(found)).toEqual([
      "ART2FULL",
      "TIE2AAAA",
      "TIE2BBBB",
      "ALS2CNFL",
      "BK2MNTH2",
    ]);
    expect(found.truncated).toBe(true);
  });

  it("gives the same rows for every limit as the start of the unlimited result", async () => {
    const sort = [
      { field: "publicationTitle", direction: "desc" },
      { field: "date", direction: "asc" },
    ] as const;
    const all = await result({ library: personal, sort });

    for (let limit = 1; limit <= 11; limit++) {
      const limited = await result({ library: personal, sort, limit });
      expect(limited.rows).toEqual(all.rows.slice(0, limit));
      expect(limited.truncated).toBe(limit < 10);
    }
  });
});

describe("queryItems sort of a large Library", () => {
  /** 1,200 more Items whose titles run against their key order. */
  function seedLargeLibrary(database: ScenarioDatabase) {
    const insertItem = database.sqlite.prepare(
      "insert into items (itemTypeID, libraryID, key) select itemTypeID, ?, ? from itemTypesCombined where typeName = 'book'",
    );
    const insertValue = database.sqlite.prepare(
      "insert into itemDataValues (value) values (?)",
    );
    const insertTitle = database.sqlite.prepare(
      "insert into itemData (itemID, fieldID, valueID) select ?, fieldID, ? from fieldsCombined where fieldName = 'title' and custom = 0",
    );
    for (let i = 0; i < 1200; i++) {
      const item = insertItem.run(
        personal.libraryID,
        `ZZ${String(i).padStart(6, "0")}`,
      ).lastInsertRowid;
      // Every third Item shares its title with two others.
      const title = `zz ${String(9999 - Math.floor(i / 3)).padStart(4, "0")}`;
      const value =
        i % 3 === 0
          ? insertValue.run(title).lastInsertRowid
          : (
              database.sqlite
                .prepare("select valueID from itemDataValues where value = ?")
                .get(title) as { valueID: number }
            ).valueID;
      insertTitle.run(item, value);
    }
  }

  const byTitle = [{ field: "title", direction: "asc" }] as const;

  it("orders every match of an unlimited query across scan pages and hydrate chunks", async () => {
    scenario = openScenarioDatabase();
    seedLargeLibrary(scenario);

    const found = await result({
      library: personal,
      fields: [],
      sort: byTitle,
    });

    expect(found.returnedCount).toBe(1210);
    expect(keys(found).slice(0, 9)).toEqual([
      "CHP2YEAR",
      "ALS2CNFL",
      "UNI2CDE2",
      "ART2FULL",
      "CNF2TEXT",
      "RPT2NDTE",
      "BK2MNTH2",
      "TIE2AAAA",
      "TIE2BBBB",
    ]);
    // "zz 9600" is the least of the added titles, on the last three keys.
    expect(keys(found).slice(9, 15)).toEqual([
      "ZZ001197",
      "ZZ001198",
      "ZZ001199",
      "ZZ001194",
      "ZZ001195",
      "ZZ001196",
    ]);
    expect(keys(found).slice(-4)).toEqual([
      "ZZ000000",
      "ZZ000001",
      "ZZ000002",
      "TIE2CCCC",
    ]);
  });
});

describe("queryItems sort failures", () => {
  it.each([
    ["noSuchField", "unknown-field"],
    ["Title", "unknown-field"],
    ["", "unknown-field"],
    ["custom", "unsortable-field"],
    ['custom["mood"]', "unsortable-field"],
    ["date.year", "unsortable-field"],
  ])(
    "fails the sort field %j with ItemQueryError before it reads the database",
    async (field, code) => {
      const error = await failure(
        {
          library: personal,
          sort: [
            { field: "title", direction: "asc" },
            { field, direction: "asc" },
          ],
        },
        false,
      );

      expect(error).toBeInstanceOf(ItemQueryError);
      expect(error).toMatchObject({
        _tag: "ItemQueryError",
        code,
        location: { argument: "sort", index: 1 },
        message: expect.stringContaining(field),
        hint: expect.stringContaining("dateModified"),
      });
    },
  );
});

describe("queryItems with a filter", () => {
  /** The Indexed Keys the filter selects, in key order. */
  const matching = async (
    filter: string,
    library: ItemQueryRequest["library"] = personal,
  ) => keys(await result({ library, filter, fields: [], sort: [] }));

  const EVERY_PERSONAL_ITEM = PERSONAL_BY_MODIFIED.toSorted();

  it("returns only the Items the Filter Expression selects", async () => {
    expect(await matching('itemType == "book"')).toEqual(["BK2MNTH2"]);
    expect(await matching("true")).toEqual(EVERY_PERSONAL_ITEM);
    expect(await matching("false")).toEqual([]);
  });

  it("reports the filter in the normalized request", async () => {
    const filter = ' itemType == "book" ';
    const found = await result({ library: personal, filter, limit: 1 });

    expect(found.query.filter).toBe(filter);
  });

  it.each(["", "   ", "\n"])("fails the empty filter %j", async (filter) => {
    const error = await failure({ library: personal, filter }, false);

    expect(error).toMatchObject({
      _tag: "ItemQueryError",
      code: "invalid-filter",
      location: { argument: "filter" },
      hint: expect.stringContaining("Omit the filter"),
    });
  });

  it("orders and limits the matches, and projects them", async () => {
    const found = await result({
      library: personal,
      filter: 'tags.contains("tie")',
      fields: ["title", "tags[0].name"],
      sort: [{ field: "title", direction: "desc" }],
      limit: 2,
    });

    expect(found.rows).toEqual([
      {
        indexedKey: "TIE2AAAA",
        values: { title: "Same Title", "tags[0].name": "tie" },
      },
      {
        indexedKey: "TIE2BBBB",
        values: { title: "Same Title", "tags[0].name": "tie" },
      },
    ]);
    expect(found.returnedCount).toBe(2);
    expect(found.truncated).toBe(true);
  });

  it("does not report truncation when the limit equals the matches", async () => {
    const found = await result({
      library: personal,
      filter: 'tags.contains("tie")',
      limit: 3,
    });

    expect(found.returnedCount).toBe(3);
    expect(found.truncated).toBe(false);
  });

  describe("exact matching", () => {
    it("matches a Tag by its exact name and keeps the Libraries apart", async () => {
      expect(await matching('tags.contains("to-read")')).toEqual([
        "ART2FULL",
        "BK2MNTH2",
      ]);
      expect(await matching('tags.contains("To-Read")')).toEqual(["ART2FULL"]);
      expect(await matching('tags.contains("TO-READ")')).toEqual([]);
      expect(await matching('tags.contains("to-read")', group)).toEqual([
        "ART2FULLg4815",
      ]);
      expect(await matching('tags.contains("group-only")')).toEqual([]);
    });

    it("matches text with its case, and folds case only with lower()", async () => {
      expect(await matching('title.contains("Exact")')).toEqual(["ART2FULL"]);
      expect(await matching('title.contains("exact")')).toEqual([]);
      expect(await matching('title.lower().contains("exact")')).toEqual([
        "ART2FULL",
      ]);
      expect(await matching('title.startsWith("Lab")')).toEqual(["RPT2NDTE"]);
      expect(await matching('title.endsWith("report")')).toEqual([]);
      expect(await matching('title == "same title"')).toEqual([]);
      expect(await matching('title == "Same Title"')).toEqual([
        "TIE2AAAA",
        "TIE2BBBB",
      ]);
    });

    it("does not normalize Unicode and reads SQL wildcard characters as text", async () => {
      // The scenario stores the Tag in its composed form.
      expect(await matching('tags.contains("Éclair")')).toEqual(["UNI2CDE2"]);
      expect(await matching('tags.contains("Éclair")')).toEqual([]);
      expect(await matching('title.startsWith("Éclair")')).toEqual([]);
      expect(await matching('title.contains("%_")')).toEqual(["UNI2CDE2"]);
      expect(await matching('title.contains("_%")')).toEqual([]);
      expect(await matching('title.contains("%")')).toEqual(["UNI2CDE2"]);
      expect(await matching('tags.contains("100%_raw\\\\path")')).toEqual([
        "UNI2CDE2",
      ]);
      expect(await matching('tags.contains("100__raw\\\\path")')).toEqual([]);
      expect(await matching('title.contains("🧪")')).toEqual(["UNI2CDE2"]);
      // `lower` gives the Turkish dotted capital I a combining dot.
      expect(await matching('title.lower().contains("istanbul")')).toEqual([]);
      expect(await matching('title.lower().contains("i̇stanbul")')).toEqual([
        "UNI2CDE2",
      ]);
    });

    it("compares a field value as a string, whether SQLite stores it as text or as a number", async () => {
      expect(await matching('volume == "12"')).toEqual([
        "ART2FULL",
        "TIE2AAAA",
        "TIE2BBBB",
      ]);
      expect(await matching("volume == 12")).toEqual([]);
      expect(await matching("volume > 3")).toEqual([]);
      expect(await matching('volume >= "12"')).toEqual([
        "ART2FULL",
        "TIE2AAAA",
        "TIE2BBBB",
      ]);
    });
  });

  describe("null", () => {
    it("gives a known field that an Item lacks the value null", async () => {
      expect(await matching("title == null")).toEqual(["TIE2CCCC"]);
      expect(await matching('title != "Same Title"')).toEqual(
        EVERY_PERSONAL_ITEM.filter(
          (key) => key !== "TIE2AAAA" && key !== "TIE2BBBB",
        ),
      );
      expect(await matching("volume != null")).toEqual([
        "ART2FULL",
        "TIE2AAAA",
        "TIE2BBBB",
      ]);
    });

    it("treats a null result as no match", async () => {
      // Null for every Item without a volume, in both directions.
      expect(await matching('volume < "2"')).toEqual([
        "ART2FULL",
        "TIE2AAAA",
        "TIE2BBBB",
      ]);
      expect(await matching('!(volume < "2")')).toEqual([]);
      expect(await matching("!title")).toEqual([]);
      expect(await matching("title.isEmpty()")).toEqual(["TIE2CCCC"]);
    });

    it("gives null for a value that one Item cannot convert, and does not fail the query", async () => {
      scenario = openScenarioDatabase();
      const { sqlite } = scenario;
      sqlite
        .prepare("insert or ignore into itemDataValues (value) values ('abc')")
        .run();
      sqlite
        .prepare(
          "insert into itemData (itemID, fieldID, valueID) select i.itemID, f.fieldID, v.valueID from items i, fieldsCombined f, itemDataValues v where i.key = 'RPT2NDTE' and i.libraryID = 1 and f.fieldName = 'volume' and f.custom = 0 and v.value = 'abc'",
        )
        .run();

      expect(await matching("volume != null")).toEqual([
        "ART2FULL",
        "RPT2NDTE",
        "TIE2AAAA",
        "TIE2BBBB",
      ]);
      expect(await matching("number(volume) > 3")).toEqual([
        "ART2FULL",
        "TIE2AAAA",
        "TIE2BBBB",
      ]);
      expect(await matching("number(volume) > 12")).toEqual([]);
    });

    it("gives null for a timestamp that cannot be parsed, in projection, filter, and sort", async () => {
      scenario = openScenarioDatabase();
      scenario.sqlite.exec(
        "update items set dateAdded = 'garbage', dateModified = 'garbage' where key = 'RPT2NDTE' and libraryID = 1",
      );

      const found = await result({
        library: personal,
        fields: ["dateAdded", "dateModified"],
        sort: [{ field: "dateAdded", direction: "asc" }],
      });
      expect(found.rows.at(-1)).toEqual({
        indexedKey: "RPT2NDTE",
        values: { dateAdded: null, dateModified: null },
      });
      expect(await matching("dateAdded == null")).toEqual(["RPT2NDTE"]);
      expect(await matching("dateModified == null")).toEqual(["RPT2NDTE"]);
      expect(await matching('dateAdded < date("2000-01-01")')).toEqual([]);
      expect(await matching('dateModified < date("2000-01-01")')).toEqual([]);
    });
  });

  describe("dates and the Query Clock", () => {
    /** The keys the filter selects at one instant in one time zone. */
    const matchingAt = async (
      filter: string,
      clock: { now: string; timeZone: string },
    ) => {
      scenario ??= openScenarioDatabase();
      const { exit } = await runEffect(
        queryItems({ library: personal, filter, fields: [], sort: [] }),
        { client: scenario.db, ...clock },
      );
      if (!Exit.isSuccess(exit)) throw new Error(String(exit.cause));
      return keys(exit.value);
    };

    // 02:00Z on 2020-01-08 is still 2020-01-07 in New York (UTC-5).
    const NEW_YORK = {
      now: "2020-01-08T02:00:00Z",
      timeZone: "America/New_York",
    };

    it("compares a timestamp with today() on the calendar day of the query time zone", async () => {
      // BK2MNTH2 was added at 06:00Z (01:00 local on 7 January), CNF2TEXT at
      // 04:00Z (23:00 local on 6 January).
      expect(await matchingAt("dateAdded >= today()", NEW_YORK)).toEqual([
        "ALS2CNFL",
        "ART2FULL",
        "BK2MNTH2",
        "RPT2NDTE",
        "TIE2AAAA",
        "TIE2BBBB",
        "TIE2CCCC",
        "UNI2CDE2",
      ]);
      expect(await matchingAt("today() == now().date()", NEW_YORK)).toEqual(
        EVERY_PERSONAL_ITEM,
      );
    });

    it("gives every call in one query the same instant", async () => {
      scenario = openScenarioDatabase();
      // A clock that moves one day forward at every read.
      let reads = 0;
      const start = Temporal.Instant.from(NEW_YORK.now).epochMilliseconds;
      const moving = (): number => start + 86_400_000 * reads++;
      const clock: Clock.Clock = {
        currentTimeMillisUnsafe: moving,
        currentTimeMillis: Effect.sync(moving),
        currentTimeNanosUnsafe: () => BigInt(moving()) * 1_000_000n,
        currentTimeNanos: Effect.sync(() => BigInt(moving()) * 1_000_000n),
        monotonicTimeNanosUnsafe: () => 0n,
        monotonicTimeNanos: Effect.succeed(0n),
        sleep: () => Effect.void,
      };

      const { exit } = await runEffect(
        Effect.provideService(
          queryItems({
            library: personal,
            filter: "now() == now() && today() == now().date()",
            fields: [],
            sort: [],
          }),
          Clock.Clock,
          clock,
        ),
        { client: scenario.db, timeZone: NEW_YORK.timeZone },
      );

      expect(Exit.isSuccess(exit) && keys(exit.value)).toEqual(
        EVERY_PERSONAL_ITEM,
      );
    });

    it("takes the instant from the Effect Clock", async () => {
      const filter = "dateAdded >= today()";

      expect(
        await matchingAt(filter, { ...NEW_YORK, now: "2024-02-29T23:00:00Z" }),
      ).toEqual(["UNI2CDE2"]);
      expect(
        await matchingAt(filter, { ...NEW_YORK, now: "2024-03-01T05:00:00Z" }),
      ).toEqual([]);
    });

    it("gives .date() of a timestamp the calendar day of the query time zone", async () => {
      expect(
        await matchingAt('dateAdded.date() == date("2020-01-06")', NEW_YORK),
      ).toEqual(["CNF2TEXT"]);
      expect(
        await matchingAt('dateAdded.date() == date("2020-01-06")', {
          ...NEW_YORK,
          timeZone: "UTC",
        }),
      ).toEqual([]);
    });

    it("computes a window from now() with a duration", async () => {
      expect(
        await matchingAt(
          'dateAdded > now() - duration("1d") && dateAdded < now()',
          NEW_YORK,
        ),
      ).toEqual(["BK2MNTH2", "CNF2TEXT"]);
    });

    it("compares partial dates as the interval of days each one covers", async () => {
      // ART2FULL 2020-03-15, ALS2CNFL 2021-06-30, UNI2CDE2 2024-02-29,
      // TIE2* 2021, BK2MNTH2 2019-11, CHP2YEAR 2018; CNF2TEXT has a text date
      // without a year and RPT2NDTE no date.
      expect(await matchingAt('date >= date("2020")', NEW_YORK)).toEqual([
        "ALS2CNFL",
        "ART2FULL",
        "TIE2AAAA",
        "TIE2BBBB",
        "TIE2CCCC",
        "UNI2CDE2",
      ]);
      expect(await matchingAt('date == date("2019-11-30")', NEW_YORK)).toEqual([
        "BK2MNTH2",
      ]);
      expect(await matchingAt('date == date("2021-06")', NEW_YORK)).toEqual([
        "ALS2CNFL",
        "TIE2AAAA",
        "TIE2BBBB",
        "TIE2CCCC",
      ]);
      expect(await matchingAt('date <= date("2018-01-01")', NEW_YORK)).toEqual([
        "CHP2YEAR",
      ]);
      expect(await matchingAt('date > date("2018-12-31")', NEW_YORK)).toEqual([
        "ALS2CNFL",
        "ART2FULL",
        "BK2MNTH2",
        "TIE2AAAA",
        "TIE2BBBB",
        "TIE2CCCC",
        "UNI2CDE2",
      ]);
      expect(await matchingAt('date == date("2024-02-29")', NEW_YORK)).toEqual([
        "UNI2CDE2",
      ]);
      expect(await matchingAt("date == null", NEW_YORK)).toEqual([
        "CNF2TEXT",
        "RPT2NDTE",
      ]);
    });

    it("reads a text date by the year in its text, and accessDate as a UTC timestamp", async () => {
      scenario = openScenarioDatabase();
      setField(scenario, "RPT2NDTE", ["date", "0000-00-00 circa 1850"]);
      // 03:00Z on 16 March is 23:00 on 15 March in New York.
      setField(scenario, "ART2FULL", ["accessDate", "2020-03-16 03:00:00"]);

      expect(await matchingAt('date == date("1850")', NEW_YORK)).toEqual([
        "RPT2NDTE",
      ]);
      expect(
        await matchingAt('accessDate.date() == date("2020-03-15")', NEW_YORK),
      ).toEqual(["ART2FULL"]);
      expect(
        await matchingAt(
          'accessDate == date("2020-03-16 03:00:00Z")',
          NEW_YORK,
        ),
      ).toEqual(["ART2FULL"]);
    });
  });

  describe("names", () => {
    it("resolves a base field through the type-specific field of each item type", async () => {
      expect(
        await matching('publicationTitle == "Handbook of Methods"'),
      ).toEqual(["CHP2YEAR"]);
      expect(
        await matching('publicationTitle == "Proceedings of Testing"'),
      ).toEqual(["CNF2TEXT"]);
      expect(await matching('bookTitle == "Handbook of Methods"')).toEqual([
        "CHP2YEAR",
      ]);
      expect(await matching('publisher == "Lab Institute"')).toEqual([
        "RPT2NDTE",
      ]);
      expect(await matching("proceedingsTitle != null")).toEqual(["CNF2TEXT"]);
    });

    it("reads the built-in field for a bare name that a custom field also has", async () => {
      // The type-specific field wins over the stored base field; the custom
      // field of the same name is reached only through custom[...].
      expect(
        await matching('publicationTitle == "Type-Specific Host"'),
      ).toEqual(["ALS2CNFL"]);
      expect(await matching('publicationTitle == "Custom Host"')).toEqual([]);
      expect(
        await matching('custom["publicationTitle"] == "Custom Host"'),
      ).toEqual(["ALS2CNFL"]);
      expect(await matching('title == "Custom Title Value"')).toEqual([]);
      expect(await matching('custom["title"] == "Custom Title Value"')).toEqual(
        ["ART2FULL"],
      );
    });

    it("reaches a custom field by its exact name and by an eligible bare name", async () => {
      expect(await matching('custom["review.status"] == "done"')).toEqual([
        "ART2FULL",
      ]);
      expect(await matching('custom["review.status"] != null')).toEqual([
        "ART2FULL",
        "BK2MNTH2",
      ]);
      expect(await matching('custom["review.status"].isEmpty()')).toEqual(
        EVERY_PERSONAL_ITEM.filter((key) => key !== "ART2FULL"),
      );
      expect(await matching('mood == "calm"')).toEqual(["ART2FULL"]);
      expect(await matching('custom.mood == "calm"')).toEqual(["ART2FULL"]);
      expect(await matching('custom["mood"] == "Calm"')).toEqual([]);
    });

    it.each([
      // Field lookup is case-sensitive.
      ['Mood == "calm"', [0, 4], "mood"],
      ['Title == "x"', [0, 5], "case-sensitive"],
      ['true && noSuchField == "x"', [8, 19], 'custom["exact name"]'],
    ])(
      "fails the unknown bare name in %j",
      async (filter, [from, to], hint) => {
        const error = await failure({ library: personal, filter });

        expect(error).toMatchObject({
          _tag: "ItemQueryError",
          code: "unknown-field",
          location: { argument: "filter", span: { from, to } },
          hint: expect.stringContaining(hint),
        });
      },
    );

    it("fails a custom field that the source does not define", async () => {
      const error = await failure({
        library: personal,
        filter: 'itemType == "book" || custom["Review.Status"] == "done"',
      });

      expect(error).toMatchObject({
        _tag: "ItemQueryError",
        code: "unknown-field",
        location: { argument: "filter", span: { from: 22, to: 45 } },
        message: expect.stringContaining('"Review.Status"'),
        hint: expect.stringContaining('"review.status"'),
      });
    });
  });

  describe("relation lists", () => {
    it("keeps one creator element for each source row", async () => {
      expect(await matching("creators.length == 2")).toEqual([
        "ART2FULL",
        "BK2MNTH2",
        "CHP2YEAR",
      ]);
      // The same person as author and as editor.
      expect(
        await matching('creators == ["Grace Hopper", "Grace Hopper"]'),
      ).toEqual(["BK2MNTH2"]);
      expect(await matching('creators == ["Grace Hopper"]')).toEqual([]);
      expect(await matching('creators.contains("Grace Hopper")')).toEqual([
        "BK2MNTH2",
        "CHP2YEAR",
      ]);
      expect(
        await matching('creators.contains("World Health Organization")'),
      ).toEqual(["ART2FULL"]);
      expect(await matching('creators[0] == "Alan Turing"')).toEqual([
        "CHP2YEAR",
      ]);
      expect(await matching("creators.isEmpty()")).toEqual([
        "ALS2CNFL",
        "RPT2NDTE",
        "TIE2CCCC",
      ]);
    });

    it("matches a Collection by its root-first path", async () => {
      expect(await matching('collections.contains("Thesis/Methods")')).toEqual([
        "ART2FULL",
        "CHP2YEAR",
      ]);
      expect(
        await matching('collections.contains("Teaching/Methods")'),
      ).toEqual(["BK2MNTH2"]);
      // Two Collections share the leaf name; the leaf name alone is no path.
      expect(await matching('collections.contains("Methods")')).toEqual([]);
      expect(await matching('collections.contains("Thesis")')).toEqual([
        "CHP2YEAR",
      ]);
      expect(await matching('collections.contains("Methods")', group)).toEqual([
        "GRP2BK22g4815",
      ]);
      expect(await matching("collections.length == 2")).toEqual(["CHP2YEAR"]);
    });

    it("matches a subtree with within", async () => {
      expect(await matching('collections.within("Thesis")')).toEqual([
        "ART2FULL",
        "CHP2YEAR",
      ]);
      expect(await matching('collections.within("Thesis/Methods")')).toEqual([
        "ART2FULL",
        "CHP2YEAR",
      ]);
      expect(await matching('collections.within("Teaching")')).toEqual([
        "BK2MNTH2",
      ]);
      expect(await matching('collections.within("Methods")')).toEqual([]);
      expect(await matching('collections.within("Thes")')).toEqual([]);
    });

    it("leaves out a trashed Collection and every Collection below it", async () => {
      expect(await matching('collections.within("Archive")')).toEqual([]);
      expect(await matching('collections.contains("Archive/Old")')).toEqual([]);
      expect(await matching('collections.contains("Old")')).toEqual([]);
    });

    it("reads Attachment presence as a boolean", async () => {
      expect(await matching("attachments")).toEqual(["ART2FULL"]);
      expect(await matching("!attachments")).toEqual(
        EVERY_PERSONAL_ITEM.filter((key) => key !== "ART2FULL"),
      );
    });

    it("matches the Zotero Key inside the Target Library", async () => {
      expect(await matching('key == "ART2FULL"')).toEqual(["ART2FULL"]);
      expect(await matching('key == "ART2FULL"', group)).toEqual([
        "ART2FULLg4815",
      ]);
      expect(await matching('key == "GRP2BK22"')).toEqual([]);
      expect(await matching('key == "TRS2SHED"')).toEqual([]);
    });
  });

  describe("validation", () => {
    it.each([
      ["title.startsWith(1)", "wrong-argument-type", [17, 18]],
      ["title.startsWith()", "wrong-argument-count", [0, 18]],
      ['noSuchFunction(title) == "a"', "unknown-function", [0, 14]],
      ['tags.startsWith("a")', "unknown-function", [5, 15]],
      ['title == "a', "invalid-filter", [11, 11]],
      ["title.lenght > 3", "unknown-property", [6, 12]],
      ['custom == "a"', "unfilterable-field", [0, 6]],
      ["dateAdded > date(2020)", "wrong-argument-type", [17, 21]],
      // A branch that never runs.
      ["false && title.startsWith(1)", "wrong-argument-type", [26, 27]],
      ["true || noSuchFunction()", "unknown-function", [8, 22]],
      ["if(true, true, title.lower(1))", "wrong-argument-count", [15, 29]],
    ])(
      "fails %j with %s before it reads the database",
      async (filter, code, [from, to]) => {
        const error = await failure({ library: personal, filter }, false);

        expect(error).toBeInstanceOf(ItemQueryError);
        expect(error).toMatchObject({
          code,
          location: { argument: "filter", span: { from, to } },
        });
        expect(error.message).not.toBe("");
        expect((error as ItemQueryError).hint).not.toBe("");
      },
    );

    it("fails the regression case title.startsWith(1) on an empty Library", async () => {
      scenario = openScenarioDatabase();
      scenario.sqlite.exec("delete from items where libraryID = 2");

      const error = await failure({
        library: group,
        filter: "title.startsWith(1)",
      });

      expect(error).toMatchObject({ code: "wrong-argument-type" });
    });
  });

  describe("hydration", () => {
    /** The relation tables and field IDs the statements of one run read. */
    function recordReads(database: ScenarioDatabase) {
      const tables = new Set<string>();
      const fieldIDs = new Set<number>();
      const { sqlite } = database;
      const prepare = sqlite.prepare.bind(sqlite);
      sqlite.prepare = (sql: string) => {
        const statement = prepare(sql);
        const all = statement.all.bind(statement);
        statement.all = ((...params: SQLInputValue[]) => {
          for (const table of [
            "itemData",
            "itemCreators",
            "itemTags",
            "collectionItems",
            "itemAttachments",
          ]) {
            if (sql.includes(`from "${table}"`)) tables.add(table);
          }
          for (const param of params) {
            if (typeof param === "string" && param.startsWith("[")) {
              for (const id of JSON.parse(param) as number[]) fieldIDs.add(id);
            }
          }
          return all(...params);
        }) as typeof statement.all;
        return statement;
      };
      return { tables, fieldIDs };
    }

    const fieldNames = (database: ScenarioDatabase, ids: Set<number>) =>
      [...ids]
        .map(
          (id) =>
            (
              database.sqlite
                .prepare(
                  "select fieldName from fieldsCombined where fieldID = ?",
                )
                .get(id) as { fieldName: string }
            ).fieldName,
        )
        .toSorted();

    it("loads nothing for a filter on the scan row", async () => {
      scenario = openScenarioDatabase();
      const reads = recordReads(scenario);

      await matching('itemType == "book" && key != "ART2FULL"');

      expect([...reads.tables]).toEqual([]);
    });

    it("loads only the relation the filter reads", async () => {
      scenario = openScenarioDatabase();
      const reads = recordReads(scenario);

      await matching('tags.contains("to-read")');

      expect([...reads.tables]).toEqual(["itemTags"]);
    });

    it("loads only the fields the filter reads, with the aliases of a base field", async () => {
      scenario = openScenarioDatabase();
      const reads = recordReads(scenario);

      await matching('publisher == "Sage" && custom["review.status"] == null');

      expect([...reads.tables]).toEqual(["itemData"]);
      const names = fieldNames(scenario, reads.fieldIDs);
      expect(names).toContain("publisher");
      expect(names).toContain("institution");
      expect(names).toContain("review.status");
      expect(names).not.toContain("title");
      expect(names).not.toContain("mood");
    });

    it("loads the fields of a branch that does not run for an Item", async () => {
      scenario = openScenarioDatabase();
      const reads = recordReads(scenario);

      expect(
        await matching('itemType == "report" && creators.isEmpty()'),
      ).toEqual(["RPT2NDTE"]);
      expect([...reads.tables]).toEqual(["itemCreators"]);
    });
  });
});

describe("queryItems candidate sets", () => {
  /** The marker of the statement that loads the Tags of a hydrate chunk. */
  const TAG_HYDRATION = '"itemTags"."itemID" in (';
  /** The marker of the statement that loads the field values of a chunk. */
  const FIELD_HYDRATION = '"itemData"."itemID" in (';
  /** The marker of the statement that loads the Collections of a chunk. */
  const COLLECTION_HYDRATION = '"collectionItems"."itemID" in (';

  /**
   * Run a filter on the personal Library, and give its Indexed Keys in key
   * order and the keys of the Items that the statement with `marker` loaded.
   */
  const hydratedReads =
    (marker: string) =>
    async (filter: string, tuning?: RunOptions["tuning"]) => {
      scenario = openScenarioDatabase();
      const loaded = recordHydratedItemIDs(scenario, marker);
      const { exit } = await runEffect(
        queryItems({ library: personal, filter, fields: [], sort: [] }),
        { client: scenario.db, tuning },
      );
      if (!Exit.isSuccess(exit)) throw new Error(String(exit.cause));
      const keyOf = scenario.sqlite.prepare(
        "select key from items where itemID = ?",
      );
      return {
        matched: keys(exit.value),
        read: [...new Set(loaded())]
          .map((itemID) => (keyOf.get(itemID) as { key: string }).key)
          .toSorted(),
      };
    };
  const tagReads = hydratedReads(TAG_HYDRATION);
  const fieldReads = hydratedReads(FIELD_HYDRATION);
  const collectionReads = hydratedReads(COLLECTION_HYDRATION);

  const EVERY_PERSONAL_ITEM = PERSONAL_BY_MODIFIED.toSorted();
  const TIE_ITEMS = ["TIE2AAAA", "TIE2BBBB", "TIE2CCCC"];

  it("reads only the Items that carry the Tag for a selective Tag filter", async () => {
    expect(await tagReads('tags.contains("tie")')).toEqual({
      matched: TIE_ITEMS,
      read: TIE_ITEMS,
    });
  });

  it("reads the candidates that are outside the query universe from no further table, and returns none of them", async () => {
    // The trashed Item TRS2SHED also carries the Tag.
    expect(await tagReads('tags.contains("to-read")')).toEqual({
      matched: ["ART2FULL", "BK2MNTH2"],
      read: ["ART2FULL", "BK2MNTH2"],
    });
    // The key of an Attachment and of a trashed Item.
    expect(await tagReads('key == "PDF2LIVE" && tags.isEmpty()')).toEqual({
      matched: [],
      read: [],
    });
    expect(
      await tagReads('key == "TRS2SHED" && tags.contains("to-read")'),
    ).toEqual({ matched: [], read: [] });
  });

  it("returns only the matches of the whole filter from a candidate set that holds more Items", async () => {
    expect(
      await tagReads('tags.contains("to-read") && itemType == "book"'),
    ).toEqual({ matched: ["BK2MNTH2"], read: ["ART2FULL", "BK2MNTH2"] });
  });

  it("reads the one Item of a Zotero Key filter", async () => {
    expect(await tagReads('key == "ART2FULL" && !tags.isEmpty()')).toEqual({
      matched: ["ART2FULL"],
      read: ["ART2FULL"],
    });
    expect(await tagReads('"ALS2CNFL" == key && tags.length == 1')).toEqual({
      matched: ["ALS2CNFL"],
      read: ["ALS2CNFL"],
    });
  });

  it("intersects the candidate sets of both sides of &&", async () => {
    expect(
      await tagReads('tags.contains("to-read") && tags.contains("methods")'),
    ).toEqual({ matched: ["ART2FULL"], read: ["ART2FULL"] });
  });

  it("uses the lowered side of && when the other side gives no set", async () => {
    expect(
      await tagReads('title.startsWith("Same") && tags.contains("tie")'),
    ).toEqual({ matched: ["TIE2AAAA", "TIE2BBBB"], read: TIE_ITEMS });
  });

  it("unites the candidate sets of || when every branch gives one", async () => {
    expect(
      await tagReads('tags.contains("eclair") || key == "RPT2NDTE"'),
    ).toEqual({
      matched: ["RPT2NDTE", "UNI2CDE2"],
      read: ["RPT2NDTE", "UNI2CDE2"],
    });
  });

  it("reads every Item when one branch of || gives no set", async () => {
    expect(
      await tagReads('tags.contains("eclair") || itemType == "report"'),
    ).toEqual({
      matched: ["RPT2NDTE", "UNI2CDE2"],
      read: EVERY_PERSONAL_ITEM,
    });
  });

  it("reads only the Items that store the value for a field-value filter", async () => {
    // `volume` is the integer 12 on ART2FULL and TIE2AAAA, text on TIE2BBBB.
    expect(await fieldReads('volume == "12"')).toEqual({
      matched: ["ART2FULL", "TIE2AAAA", "TIE2BBBB"],
      read: ["ART2FULL", "TIE2AAAA", "TIE2BBBB"],
    });
    expect(await fieldReads('"Same Title" == title')).toEqual({
      matched: ["TIE2AAAA", "TIE2BBBB"],
      read: ["TIE2AAAA", "TIE2BBBB"],
    });
  });

  it("reads the Items of every alias of a base field for a field-value filter", async () => {
    expect(
      await fieldReads('publicationTitle == "Handbook of Methods"'),
    ).toEqual({ matched: ["CHP2YEAR"], read: ["CHP2YEAR"] });
    expect(await fieldReads('publisher == "Lab Institute"')).toEqual({
      matched: ["RPT2NDTE"],
      read: ["RPT2NDTE"],
    });
    // ALS2CNFL stores both: the type-specific value is the field's value.
    expect(await fieldReads('publicationTitle == "Base Field Host"')).toEqual({
      matched: [],
      read: ["ALS2CNFL"],
    });
  });

  it("reads only the Items filed in the Collection for a Collection filter", async () => {
    // The trashed Item TRS2SHED is also filed in Thesis/Methods.
    expect(
      await collectionReads('collections.contains("Thesis/Methods")'),
    ).toEqual({
      matched: ["ART2FULL", "CHP2YEAR"],
      read: ["ART2FULL", "CHP2YEAR"],
    });
    expect(await collectionReads('collections.contains("Thesis")')).toEqual({
      matched: ["CHP2YEAR"],
      read: ["CHP2YEAR"],
    });
  });

  it("reads the Items of the whole subtree for within", async () => {
    expect(await collectionReads('collections.within("Thesis")')).toEqual({
      matched: ["ART2FULL", "CHP2YEAR"],
      read: ["ART2FULL", "CHP2YEAR"],
    });
    expect(await collectionReads('collections.within("Thes")')).toEqual({
      matched: [],
      read: [],
    });
  });

  it("reads separate sets for two Collections with the same name", async () => {
    expect(
      await collectionReads('collections.contains("Teaching/Methods")'),
    ).toEqual({ matched: ["BK2MNTH2"], read: ["BK2MNTH2"] });
    expect(await collectionReads('collections.contains("Methods")')).toEqual({
      matched: [],
      read: [],
    });
  });

  it("reads no Item for a trashed Collection and the Collections below it", async () => {
    expect(await collectionReads('collections.within("Archive")')).toEqual({
      matched: [],
      read: [],
    });
    expect(
      await collectionReads('collections.contains("Archive/Old")'),
    ).toEqual({ matched: [], read: [] });
  });

  it.each([
    "volume == 12",
    'volume != "12"',
    '!(volume == "12")',
    'volume.lower() == "12"',
    'custom["review.status"] == "done"',
    'mood == "calm"',
  ])("reads every Item's fields for %j", async (filter) => {
    expect((await fieldReads(filter)).read).toEqual(EVERY_PERSONAL_ITEM);
  });

  it.each([
    "collections.contains(title)",
    "collections.contains(12)",
    'collections == ["Thesis"]',
    'collections.containsAny("Thesis")',
    '!collections.within("Thesis")',
  ])("reads every Item's Collections for %j", async (filter) => {
    expect((await collectionReads(filter)).read).toEqual(EVERY_PERSONAL_ITEM);
  });

  it.each([
    '!tags.contains("tie")',
    '!!tags.contains("tie")',
    'if(tags.contains("tie"), true, false)',
    'tags.contains("tie") == true',
    'tags.containsAny("tie")',
    'tags.contains("TIE".lower())',
    'tags.length > 0 && key != "ART2FULL"',
  ])("reads every Item for %j", async (filter) => {
    expect((await tagReads(filter)).read).toEqual(EVERY_PERSONAL_ITEM);
  });

  it("uses a candidate set of at most 25% of the Library's `items` rows, and the scan for a larger one", async () => {
    // The personal Library has 15 `items` rows: the cap is 3 Items. The Tag
    // `tie` is on 3 Items; `tie` and `methods` together are on 5.
    const within = await tagReads('tags.contains("tie")');
    const above = await tagReads(
      'tags.contains("tie") || tags.contains("methods")',
    );

    expect(within.read).toEqual(TIE_ITEMS);
    expect(above).toEqual({
      matched: ["ALS2CNFL", "ART2FULL", ...TIE_ITEMS],
      read: EVERY_PERSONAL_ITEM,
    });
  });

  it("uses the side of && within the cap when the other side is above it", async () => {
    scenario = openScenarioDatabase();
    // The Tag `methods` on four more Items: five in total, above the cap of 3.
    scenario.sqlite.exec(
      `insert into itemTags (itemID, tagID, type)
       select itemID, (select tagID from tags where name = 'methods'), 0
       from items where key in ('TIE2AAAA', 'TIE2BBBB', 'RPT2NDTE', 'CNF2TEXT') and libraryID = 1`,
    );
    const loaded = recordHydratedItemIDs(scenario, TAG_HYDRATION);

    const found = await result({
      library: personal,
      filter: 'tags.contains("methods") && tags.contains("tie")',
      fields: [],
      sort: [],
    });

    expect(keys(found)).toEqual(["TIE2AAAA", "TIE2BBBB"]);
    expect(new Set(loaded()).size).toBe(3);
  });

  it("gives the same result with the scan forced by the tuning reference", async () => {
    expect(await tagReads('tags.contains("tie")', { forceScan: true })).toEqual(
      { matched: TIE_ITEMS, read: EVERY_PERSONAL_ITEM },
    );
  });

  it("takes the cap ratio from the tuning reference", async () => {
    expect(
      (await tagReads('tags.contains("tie")', { capRatio: 0.1 })).read,
    ).toEqual(EVERY_PERSONAL_ITEM);
    expect(
      (
        await tagReads('tags.contains("tie") || tags.contains("methods")', {
          capRatio: 0.5,
        })
      ).read,
    ).toEqual(["ALS2CNFL", "ART2FULL", ...TIE_ITEMS]);
  });

  it("keeps a Tag and a Zotero Key of the other Library out of the result", async () => {
    const matching = async (
      filter: string,
      library: ItemQueryRequest["library"],
    ) => keys(await result({ library, filter, fields: [], sort: [] }));

    // `to-read` and the key ART2FULL exist in both Libraries.
    expect(await matching('tags.contains("to-read")', group)).toEqual([
      "ART2FULLg4815",
    ]);
    expect(await matching('key == "ART2FULL"', group)).toEqual([
      "ART2FULLg4815",
    ]);
    expect(await matching('key == "ART2FULL"', personal)).toEqual(["ART2FULL"]);
    // `group-only` and GRP2BK22 exist in the group Library only.
    expect(await matching('tags.contains("group-only")', personal)).toEqual([]);
    expect(await matching('key == "GRP2BK22"', personal)).toEqual([]);
    expect(
      await matching('tags.contains("group-only") || key == "GRP2BK22"', group),
    ).toEqual(["GRP2BK22g4815"]);
  });

  it("reads a candidate set that is larger than one universe chunk and one hydrate chunk", async () => {
    scenario = openScenarioDatabase();
    const insert = scenario.sqlite.prepare(
      "insert into items (itemTypeID, libraryID, key) select itemTypeID, ?, ? from itemTypesCombined where typeName = 'book'",
    );
    for (let i = 0; i < 3000; i++) {
      insert.run(personal.libraryID, `ZZ${String(i).padStart(6, "0")}`);
    }
    // 700 of the 3,015 `items` rows carry the Tag: within the cap of 753.
    scenario.sqlite.exec(
      `insert into itemTags (itemID, tagID, type)
       select itemID, (select tagID from tags where name = 'group-only'), 0
       from items where key >= 'ZZ000000' and key < 'ZZ000700' and libraryID = 1`,
    );
    const loaded = recordHydratedItemIDs(scenario, TAG_HYDRATION);

    const found = await result({
      library: personal,
      filter: 'tags.contains("group-only")',
      fields: [],
      sort: [],
    });

    expect(found.returnedCount).toBe(700);
    expect(keys(found).at(0)).toBe("ZZ000000");
    expect(keys(found).at(-1)).toBe("ZZ000699");
    expect(new Set(loaded()).size).toBe(700);
  });
});
