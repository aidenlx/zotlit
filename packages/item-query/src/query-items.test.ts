import { Cause, Effect, Exit } from "effect";
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

  it("merges the sorted runs of an unlimited query in steps between which the scheduler pauses", async () => {
    scenario = openScenarioDatabase();
    seedLargeLibrary(scenario);
    const request = { library: personal, fields: [], sort: byTitle };

    // A limit that every Item fits in reads and hydrates the same chunks, and
    // keeps its rows in order as it reads: the extra pauses are in the merge.
    // Five hydrate chunks give five runs, which takes four merges.
    const limited = await run({ ...request, limit: 1210 });
    const unlimited = await run(request);

    if (!Exit.isSuccess(limited.exit) || !Exit.isSuccess(unlimited.exit)) {
      throw new Error("a query did not succeed.");
    }
    expect(unlimited.exit.value.rows).toEqual(limited.exit.value.rows);
    expect(unlimited.pauses).toBeGreaterThanOrEqual(limited.pauses + 4);
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
