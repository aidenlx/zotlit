import { Cause, Clock, Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";

import { ItemQueryDatabase, ItemQueryLayoutError } from "@zotlit/db/item-query";
import type { StatementRun } from "@zotlit/db/item-query";
import {
  BULK_TAG,
  openScenarioDatabase,
  SCENARIO_LIBRARIES,
  seedBulkLibrary,
} from "@zotlit/db/test-scenario";
import type { ScenarioDatabase } from "@zotlit/db/test-scenario";

import {
  ANNOTATIONS,
  consumeQuery,
  collectQuery,
  ITEMS,
  ItemQueryError,
  ItemQueryScheduler,
} from ".";
import type {
  ItemQuery,
  ItemQueryErrorCode,
  ItemQueryRequest,
  QueryDataset,
  QueryResult,
  QueryRow,
  SortSpec,
} from ".";
import { runEffect } from "./test-helpers";
import type { RunEvent, RunOptions } from "./test-helpers";

const { personal, group } = SCENARIO_LIBRARIES;

function run(scenario: ScenarioDatabase, request: ItemQueryRequest) {
  return runEffect(collectQuery(ITEMS, request), { client: scenario.db });
}

async function result(
  scenario: ScenarioDatabase,
  request: ItemQueryRequest,
): Promise<QueryResult> {
  const { exit } = await run(scenario, request);
  if (!Exit.isSuccess(exit)) throw new Error(String(exit.cause));
  return exit.value;
}

/** The typed failure of a run; a defect or an interruption fails the test. */
async function failure(
  scenario: ScenarioDatabase,
  request: ItemQueryRequest,
  client = true,
) {
  const { exit } = await runEffect(collectQuery(ITEMS, request), {
    client: client ? scenario.db : undefined,
  });
  if (!Exit.isFailure(exit)) throw new Error("the query did not fail.");
  const error = Cause.findErrorOption(exit.cause);
  if (error._tag === "None") throw new Error(String(exit.cause));
  return error.value;
}

const keys = (found: QueryResult) => found.rows.map((row) => row.indexedKey);

/**
 * The hydrate statements of a run: `fields` loads the field values of a chunk,
 * `relation` loads one relation of a chunk.
 */
function hydrates(
  events: readonly RunEvent[],
  kind: "fields" | "relation",
): StatementRun[] {
  return events.flatMap((event) =>
    event.type === "statement" &&
    event.statement.reader === "hydrate-chunk" &&
    "fieldIDs" in event.statement.params === (kind === "fields")
      ? [event.statement]
      : [],
  );
}

/** The Item IDs that the ID slots of one statement bind. */
function itemIDsBound(statement: StatementRun): number[] {
  return Object.values(statement.params).filter(
    (param): param is number => typeof param === "number",
  );
}

/** Store a built-in field value on a personal Item of the scenario. */
function setField(
  database: ScenarioDatabase,
  key: string,
  [field, value]: readonly [string, string | number | bigint],
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

describe("collectQuery(ITEMS) without a filter", () => {
  it("returns the live top-level Items of the Library, most recently modified first", async () => {
    using scenario = openScenarioDatabase();
    const found = await result(scenario, { libraries: [personal] });

    expect(keys(found)).toEqual(PERSONAL_BY_MODIFIED);
    expect(found.returnedCount).toBe(10);
    expect(found.truncated).toBe(false);
  });

  it("keeps the two Libraries apart and gives group Items their group Indexed Key", async () => {
    using scenario = openScenarioDatabase();
    const found = await result(scenario, { libraries: [group] });

    expect(keys(found)).toEqual(["ART2FULLg4815", "GRP2BK22g4815"]);
  });

  it("reads a Library that is larger than one scan page", async () => {
    using scenario = openScenarioDatabase();
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

    const all = await result(scenario, { libraries: [personal] });
    const newest = await result(scenario, { libraries: [personal], limit: 2 });

    expect(all.returnedCount).toBe(1210);
    expect(keys(all).slice(0, 2)).toEqual(["ZZ008800", "ZZ008801"]);
    expect(keys(all).slice(-10)).toEqual(PERSONAL_BY_MODIFIED);
    expect(keys(newest)).toEqual(["ZZ008800", "ZZ008801"]);
    expect(newest.truncated).toBe(true);
  });
});

describe("collectQuery(ITEMS) with a limit", () => {
  it("breaks a tie inside the limit by Indexed Key", async () => {
    using scenario = openScenarioDatabase();
    const found = await result(scenario, { libraries: [personal], limit: 5 });

    expect(keys(found).slice(3)).toEqual(["TIE2AAAA", "TIE2BBBB"]);
    expect(found.truncated).toBe(true);
  });
});

describe("collectQuery(ITEMS) projection", () => {
  it("projects the item type, title, creators, date, and modification time when the caller names no fields", async () => {
    using scenario = openScenarioDatabase();
    const found = await result(scenario, { libraries: [personal], limit: 1 });

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
});

/** The `values` of each row by Indexed Key. */
const valuesByKey = (found: QueryResult) =>
  Object.fromEntries(found.rows.map((row) => [row.indexedKey, row.values]));

describe("collectQuery(ITEMS) Projection Paths", () => {
  it("projects full, partial, text, and missing dates as structured values", async () => {
    using scenario = openScenarioDatabase();
    const found = await result(scenario, {
      libraries: [personal],
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
    using scenario = openScenarioDatabase();
    const found = await result(scenario, {
      libraries: [personal],
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
    using scenario = openScenarioDatabase();
    const found = await result(scenario, {
      libraries: [personal],
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
    using scenario = openScenarioDatabase();
    const found = await result(scenario, {
      libraries: [personal],
      fields: ["volume"],
    });
    const values = valuesByKey(found);

    expect(values["TIE2AAAA"]).toEqual({ volume: "12" });
    expect(values["TIE2BBBB"]).toEqual({ volume: "12" });
    expect(values["TIE2CCCC"]).toEqual({ volume: null });
  });

  it.each([
    9007199254740993n,
    9223372036854775807n,
    -9223372036854775808n,
    // A REAL whose JavaScript string denotes a different exact integer.
    1_000_000_000_000_000_100,
  ])(
    "preserves the stored number %s in projection and both filter plans",
    async (value) => {
      using scenario = openScenarioDatabase();
      setField(scenario, "ART2FULL", ["volume", value]);
      const request = {
        libraries: [personal],
        fields: ["volume"],
        sort: [],
      };
      const projected = await result(scenario, request);
      expect(valuesByKey(projected)["ART2FULL"]).toEqual({
        volume: String(value),
      });
      for (const forceScan of [false, true]) {
        const { exit } = await runEffect(
          collectQuery(ITEMS, { ...request, filter: `volume == "${value}"` }),
          { client: scenario.db, tuning: { forceScan } },
        );
        if (!Exit.isSuccess(exit)) throw new Error(String(exit.cause));
        expect(exit.value.rows).toEqual([
          { indexedKey: "ART2FULL", values: { volume: String(value) } },
        ]);
      }
    },
  );

  it("reaches custom fields by exact source name, in bracket or dotted form", async () => {
    using scenario = openScenarioDatabase();
    const found = await result(scenario, {
      libraries: [personal],
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
    using scenario = openScenarioDatabase();
    const found = await result(scenario, {
      libraries: [personal],
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
    using scenario = openScenarioDatabase();
    const { exit, events } = await run(scenario, {
      libraries: [personal],
      fields: ["title"],
      limit: 2,
    });

    if (!Exit.isSuccess(exit)) throw new Error(String(exit.cause));
    expect(keys(exit.value)).toEqual(["ART2FULL", "UNI2CDE2"]);
    const byNumber = (a: number, b: number) => a - b;
    expect(
      hydrates(events, "fields").flatMap(itemIDsBound).toSorted(byNumber),
    ).toEqual(itemIDsOf(scenario, ["ART2FULL", "UNI2CDE2"]).toSorted(byNumber));
  });

  it("reads Items of a Library larger than one hydrate chunk", async () => {
    using scenario = openScenarioDatabase();
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

    const found = await result(scenario, {
      libraries: [personal],
      fields: ["title"],
    });

    expect(found.returnedCount).toBe(610);
    expect(
      found.rows.filter((row) => row.values["title"] === "Lab Report"),
    ).toHaveLength(601);
  });
});

describe("collectQuery(ITEMS) relation lists", () => {
  it("projects each Relation List element in source order and keeps null positions", async () => {
    using scenario = openScenarioDatabase();
    const found = await result(scenario, {
      libraries: [personal],
      fields: [
        "creators",
        "creators[]",
        "creators[].fullName",
        "creators[].literal",
        "tags[].name",
        "collections[]",
      ],
    });
    const values = valuesByKey(found);
    expect(values.ART2FULL).toMatchObject({
      "creators[].fullName": ["Ada Lovelace", "World Health Organization"],
      "creators[].literal": [null, "World Health Organization"],
      "tags[].name": ["methods", "to-read", "To-Read"],
      "collections[]": ["Thesis/Methods"],
    });
    expect(values.BK2MNTH2?.["creators[].fullName"]).toEqual([
      "Grace Hopper",
      "Grace Hopper",
    ]);
    expect(values.RPT2NDTE).toEqual({
      creators: [],
      "creators[]": [],
      "creators[].fullName": [],
      "creators[].literal": [],
      "tags[].name": [],
      "collections[]": [],
    });
    for (const row of found.rows)
      expect(row.values["creators[]"]).toEqual(row.values.creators);
  });

  it("projects Creators in Zotero's creator order, one element for each row", async () => {
    using scenario = openScenarioDatabase();
    const found = await result(scenario, {
      libraries: [personal],
      fields: ["creators"],
    });
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
    using scenario = openScenarioDatabase();
    const found = await result(scenario, {
      libraries: [personal],
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
    using scenario = openScenarioDatabase();
    const found = await result(scenario, {
      libraries: [personal],
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
    using scenario = openScenarioDatabase();
    const found = await result(scenario, {
      libraries: [group],
      fields: ["collections"],
    });

    expect(valuesByKey(found)).toEqual({
      ART2FULLg4815: { collections: [] },
      GRP2BK22g4815: { collections: ["Methods"] },
    });
  });

  it("projects Attachment presence as true for an Item with a live Attachment", async () => {
    using scenario = openScenarioDatabase();
    const found = await result(scenario, {
      libraries: [personal],
      fields: ["attachments"],
    });

    expect(valuesByKey(found)["ART2FULL"]).toEqual({ attachments: true });
    expect(valuesByKey(found)["RPT2NDTE"]).toEqual({ attachments: false });
  });

  it("projects Attachment presence as false for an Item with only trashed Attachments", async () => {
    using scenario = openScenarioDatabase();
    // ART2FULL keeps only its already trashed Attachment.
    scenario.sqlite.exec(
      "insert into deletedItems (itemID, dateDeleted) select itemID, '2024-01-01 00:00:00' from items where key = 'PDF2LIVE'",
    );

    const found = await result(scenario, {
      libraries: [personal],
      fields: ["attachments"],
    });

    expect(valuesByKey(found)["ART2FULL"]).toEqual({ attachments: false });
  });

  it("loads each relation only for the rows a limited query returns", async () => {
    using scenario = openScenarioDatabase();
    const { exit, events } = await run(scenario, {
      libraries: [personal],
      fields: ["creators", "tags", "collections", "attachments"],
      limit: 2,
    });

    if (!Exit.isSuccess(exit)) throw new Error(String(exit.cause));
    const byNumber = (a: number, b: number) => a - b;
    const returned = itemIDsOf(scenario, ["ART2FULL", "UNI2CDE2"]);
    // One statement for each relation, and no field values.
    expect(hydrates(events, "fields")).toEqual([]);
    const relations = hydrates(events, "relation");
    expect(relations).toHaveLength(4);
    for (const statement of relations) {
      expect(itemIDsBound(statement).toSorted(byNumber)).toEqual(
        returned.toSorted(byNumber),
      );
    }
  });

  it("loads no relation that the query does not read", async () => {
    using scenario = openScenarioDatabase();
    const { exit, events } = await run(scenario, {
      libraries: [personal],
      fields: ["title", "attachments"],
    });

    if (!Exit.isSuccess(exit)) throw new Error(String(exit.cause));
    // The title of the one chunk, and its Attachment presence: each row of
    // that statement is the ID of a parent Item.
    expect(hydrates(events, "fields")).toHaveLength(1);
    const [attachments, ...more] = hydrates(events, "relation");
    expect(more).toEqual([]);
    expect(attachments!.rows.length).toBeGreaterThan(0);
    for (const row of attachments!.rows) {
      expect(Object.keys(row as object)).toEqual(["itemID"]);
    }
  });

  it("reaches one Creator by index, with null past the end", async () => {
    using scenario = openScenarioDatabase();
    const found = await result(scenario, {
      libraries: [personal],
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

describe("collectQuery(ITEMS) failures", () => {
  it("fails a custom field that the source does not define", async () => {
    using scenario = openScenarioDatabase();
    const error = await failure(scenario, {
      libraries: [personal],
      fields: ['custom["Review.Status"]'],
    });

    expect(error).toMatchObject({
      _tag: "ItemQueryError",
      code: "unknown-field",
      location: { argument: "fields", index: 0 },
    });
  });

  it("fails with the tagged database error when a statement fails", async () => {
    using scenario = openScenarioDatabase();
    // The copy passes the layout check first, so the statement itself fails.
    await result(scenario, { libraries: [personal], limit: 1 });
    scenario.sqlite.exec("drop table deletedItems");

    const error = await failure(scenario, { libraries: [personal] });

    expect(error).toMatchObject({
      _tag: "ItemQueryDatabaseError",
      query: expect.stringContaining("deletedItems"),
      cause: expect.objectContaining({
        message: expect.stringContaining("deletedItems"),
      }),
    });
  });
});

describe("collectQuery(ITEMS) on the layout of the Zotero database", () => {
  function stamp(
    scenario: ScenarioDatabase,
    versions: { userdata: number; compatibility: number },
  ) {
    const update = scenario.sqlite.prepare(
      "update version set version = ? where schema = ?",
    );
    update.run(versions.userdata, "userdata");
    update.run(versions.compatibility, "compatibility");
  }

  it("fails with ItemQueryLayoutError when a copy stamped inside the supported range lacks a manifest column", async () => {
    using scenario = openScenarioDatabase();
    stamp(scenario, { userdata: 129, compatibility: 9 });
    scenario.sqlite.exec('alter table "fieldsCombined" drop column "custom"');

    const error = await failure(scenario, {
      libraries: [personal],
      fields: [],
    });

    expect(error).toBeInstanceOf(ItemQueryLayoutError);
    expect(error).toMatchObject({
      _tag: "ItemQueryLayoutError",
      missing: [{ table: "fieldsCombined", column: "custom" }],
      message: expect.stringContaining("Update ZotLit"),
    });
  });

  it("gives the oracle result on a copy stamped outside the supported range with the full layout", async () => {
    using scenario = openScenarioDatabase();
    stamp(scenario, { userdata: 140, compatibility: 12 });

    const found = await result(scenario, {
      libraries: [personal],
      fields: ["title"],
    });

    expect(keys(found)).toEqual(PERSONAL_BY_MODIFIED);
    expect(found.rows[0]!.values).toEqual({
      title: "Exact Matching in Literature Review",
    });
  });
});

describe("collectQuery(ITEMS) under a scheduler", () => {
  it("pauses between operations and gives the result of the exported scheduler", async () => {
    using scenario = openScenarioDatabase();
    const request: ItemQueryRequest = { libraries: [personal], limit: 4 };

    const stepped = await run(scenario, request);
    const production = await Effect.runPromiseExit(
      Effect.provideService(collectQuery(ITEMS, request), ItemQueryDatabase, {
        client: scenario.db,
      }),
      { scheduler: new ItemQueryScheduler() },
    );

    expect(stepped.pauses).toBeGreaterThan(0);
    expect(Exit.isSuccess(production)).toBe(true);
    expect(stepped.exit).toEqual(production);
  });
});

describe("collectQuery(ITEMS) sort", () => {
  const sortedKeys = async (
    scenario: ScenarioDatabase,
    sort: ItemQueryRequest["sort"],
    limit?: number,
  ): Promise<string[]> =>
    keys(
      await result(scenario, {
        libraries: [personal],
        fields: [],
        sort,
        limit,
      }),
    );

  it("orders by a string field in ascending order, with a missing value last and a tie in Indexed Key order", async () => {
    using scenario = openScenarioDatabase();
    expect(
      await sortedKeys(scenario, [{ field: "title", direction: "asc" }]),
    ).toEqual([
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
    using scenario = openScenarioDatabase();
    expect(
      await sortedKeys(scenario, [{ field: "title", direction: "desc" }]),
    ).toEqual([
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
    using scenario = openScenarioDatabase();
    expect(
      await sortedKeys(scenario, [
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
    using scenario = openScenarioDatabase();
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

    expect(
      await sortedKeys(scenario, [{ field: "volume", direction: "asc" }]),
    ).toEqual([...valued, ...missing]);
    expect(
      await sortedKeys(scenario, [{ field: "volume", direction: "desc" }]),
    ).toEqual([...valued, ...missing]);
  });

  it("orders by Indexed Key alone for an empty sort list", async () => {
    using scenario = openScenarioDatabase();
    expect(await sortedKeys(scenario, [])).toEqual(
      PERSONAL_BY_MODIFIED.toSorted(),
    );
  });

  it("orders a date field by the first day each date can mean, with a text date and a missing date last", async () => {
    using scenario = openScenarioDatabase();
    expect(
      await sortedKeys(scenario, [{ field: "date", direction: "asc" }]),
    ).toEqual([
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
    using scenario = openScenarioDatabase();
    expect(
      await sortedKeys(scenario, [
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

  it("sorts strings in the pinned collation order: digits lexically, then letters with case and accents as the last difference", async () => {
    using scenario = openScenarioDatabase();
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

    const found = await result(scenario, {
      libraries: [group],
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
    using scenario = openScenarioDatabase();
    const { sqlite } = scenario;
    const fieldID = (name: string) =>
      (
        sqlite
          .prepare(
            "select fieldID from fieldsCombined where fieldName = ? and custom = 0",
          )
          .get(name) as { fieldID: number }
      ).fieldID;
    const { exit, events } = await run(scenario, {
      libraries: [personal],
      fields: ["DOI"],
      sort: [{ field: "title", direction: "asc" }],
      limit: 2,
    });

    if (!Exit.isSuccess(exit)) throw new Error(String(exit.cause));
    expect(exit.value.rows).toEqual([
      { indexedKey: "CHP2YEAR", values: { DOI: null } },
      { indexedKey: "ALS2CNFL", values: { DOI: null } },
    ]);
    const byNumber = (a: number, b: number) => a - b;
    // The Items each field-value statement reads, by the fields it reads.
    const itemsRead = (name: string) =>
      hydrates(events, "fields")
        .filter((statement) =>
          (
            JSON.parse(statement.params["fieldIDs"] as string) as number[]
          ).includes(fieldID(name)),
        )
        .flatMap(itemIDsBound)
        .toSorted(byNumber);
    expect(itemsRead("title")).toEqual(
      itemIDsOf(scenario, PERSONAL_BY_MODIFIED).toSorted(byNumber),
    );
    expect(itemsRead("DOI")).toEqual(
      itemIDsOf(scenario, ["CHP2YEAR", "ALS2CNFL"]).toSorted(byNumber),
    );
  });
});

describe("collectQuery(ITEMS) sort with a limit", () => {
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

  it.each([
    ["exactly `limit` Items match", 10, false],
    ["`limit + 1` Items match", 9, true],
  ])(
    "returns the first rows of the sort when %s",
    async (_, limit, truncated) => {
      using scenario = openScenarioDatabase();
      const found = await result(scenario, {
        libraries: [personal],
        sort: byTitle,
        limit,
      });

      expect(keys(found)).toEqual(BY_TITLE.slice(0, limit));
      expect(found.returnedCount).toBe(limit);
      expect(found.truncated).toBe(truncated);
    },
  );

  it("cuts a tie group at the limit in Indexed Key order", async () => {
    using scenario = openScenarioDatabase();
    const found = await result(scenario, {
      libraries: [personal],
      sort: byTitle,
      limit: 8,
    });

    expect(keys(found).slice(-2)).toEqual(["BK2MNTH2", "TIE2AAAA"]);
    expect(found.truncated).toBe(true);
  });

  it("cuts the Items without a value at the limit in Indexed Key order", async () => {
    using scenario = openScenarioDatabase();
    const found = await result(scenario, {
      libraries: [personal],
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
});

describe("collectQuery(ITEMS) sort of a large Library", () => {
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
    using scenario = openScenarioDatabase();
    seedLargeLibrary(scenario);

    const found = await result(scenario, {
      libraries: [personal],
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

describe("collectQuery(ITEMS) accessDate", () => {
  // The scenario stores 2020-01-07 04:00:00 (UTC) on RPT2NDTE, the calendar
  // day 2020-01-07 on CHP2YEAR, and "yesterday" on UNI2CDE2. New York is
  // UTC-5 in January, so 7 January starts there at 05:00Z.
  const NEW_YORK = {
    now: "2020-01-08T02:00:00Z",
    timeZone: "America/New_York",
  };
  const MISSING = [
    "ALS2CNFL",
    "ART2FULL",
    "BK2MNTH2",
    "CNF2TEXT",
    "TIE2AAAA",
    "TIE2CCCC",
    "UNI2CDE2",
  ];

  /** A later timestamp and an impossible date beside the scenario values. */
  function withAccessDates(scenario: ScenarioDatabase): void {
    setField(scenario, "TIE2BBBB", ["accessDate", "2020-01-07 05:30:00"]);
    setField(scenario, "BK2MNTH2", ["accessDate", "2021-02-30 10:00:00"]);
  }

  async function query(
    scenario: ScenarioDatabase,
    request: Omit<ItemQueryRequest, "libraries">,
    clock: { now: string; timeZone: string } = NEW_YORK,
  ): Promise<QueryResult> {
    const { exit } = await runEffect(
      collectQuery(ITEMS, { libraries: [personal], ...request }),
      { client: scenario.db, ...clock },
    );
    if (!Exit.isSuccess(exit)) throw new Error(String(exit.cause));
    return exit.value;
  }

  const sorted = async (
    scenario: ScenarioDatabase,
    direction: "asc" | "desc",
    clock?: { now: string; timeZone: string },
  ) =>
    keys(
      await query(
        scenario,
        { fields: [], sort: [{ field: "accessDate", direction }] },
        clock,
      ),
    );

  it("projects the value the filter reads: a timestamp, a calendar day, or null", async () => {
    using scenario = openScenarioDatabase();
    withAccessDates(scenario);
    const found = await query(scenario, {
      filter: 'key != "TIE2AAAA" && key != "TIE2CCCC"',
      fields: ["accessDate"],
      sort: [],
    });

    expect(valuesByKey(found)).toEqual({
      ALS2CNFL: { accessDate: null },
      ART2FULL: { accessDate: null },
      BK2MNTH2: { accessDate: null },
      CHP2YEAR: { accessDate: Temporal.PlainDate.from("2020-01-07") },
      CNF2TEXT: { accessDate: null },
      RPT2NDTE: { accessDate: Temporal.Instant.from("2020-01-07T04:00:00Z") },
      TIE2BBBB: { accessDate: Temporal.Instant.from("2020-01-07T05:30:00Z") },
      UNI2CDE2: { accessDate: null },
    });
  });

  it("orders by time, a calendar day from its start in the query time zone, with a value that does not parse last", async () => {
    using scenario = openScenarioDatabase();
    withAccessDates(scenario);

    // 04:00Z is 23:00 on 6 January in New York, before 7 January starts.
    expect(await sorted(scenario, "asc")).toEqual([
      "RPT2NDTE",
      "CHP2YEAR",
      "TIE2BBBB",
      ...MISSING,
    ]);
    expect(await sorted(scenario, "desc")).toEqual([
      "TIE2BBBB",
      "CHP2YEAR",
      "RPT2NDTE",
      ...MISSING,
    ]);
  });

  it("keeps the time order under a limit", async () => {
    using scenario = openScenarioDatabase();
    withAccessDates(scenario);
    const limited = await query(scenario, {
      fields: [],
      sort: [{ field: "accessDate", direction: "desc" }],
      limit: 2,
    });

    expect(keys(limited)).toEqual(["TIE2BBBB", "CHP2YEAR"]);
    expect(limited.truncated).toBe(true);
  });

  it("starts a calendar day before a timestamp of the same date in a zone east of UTC", async () => {
    using scenario = openScenarioDatabase();
    // 7 January starts at 15:00Z on 6 January in Tokyo (UTC+9).
    const tokyo = { now: "2020-01-08T02:00:00Z", timeZone: "Asia/Tokyo" };

    expect(await sorted(scenario, "asc", tokyo)).toEqual([
      "CHP2YEAR",
      "RPT2NDTE",
      "ALS2CNFL",
      "ART2FULL",
      "BK2MNTH2",
      "CNF2TEXT",
      "TIE2AAAA",
      "TIE2BBBB",
      "TIE2CCCC",
      "UNI2CDE2",
    ]);
  });

  it("starts a calendar day after a daylight-saving change at the offset of that day", async () => {
    using scenario = openScenarioDatabase();
    // Daylight-saving time starts in New York on 8 March 2020: 9 March starts
    // at 04:00Z (UTC-4), 8 March at 05:00Z (UTC-5).
    setField(scenario, "TIE2AAAA", ["accessDate", "2020-03-09"]);
    setField(scenario, "TIE2BBBB", ["accessDate", "2020-03-09 04:30:00"]);
    setField(scenario, "BK2MNTH2", ["accessDate", "2020-03-08 04:30:00"]);
    setField(scenario, "ART2FULL", ["accessDate", "2020-03-08"]);

    expect(
      await sorted(scenario, "asc", {
        now: "2020-03-10T00:00:00Z",
        timeZone: "America/New_York",
      }),
    ).toEqual([
      "RPT2NDTE",
      "CHP2YEAR",
      "BK2MNTH2",
      "ART2FULL",
      "TIE2AAAA",
      "TIE2BBBB",
      "ALS2CNFL",
      "CNF2TEXT",
      "TIE2CCCC",
      "UNI2CDE2",
    ]);
  });

  it("reads a value that does not parse as null in a filter", async () => {
    using scenario = openScenarioDatabase();
    withAccessDates(scenario);
    const found = await query(scenario, {
      filter: "accessDate == null",
      fields: [],
      sort: [],
    });

    expect(keys(found)).toEqual(MISSING);
  });
});

describe("collectQuery(ITEMS) with a filter", () => {
  /** The Indexed Keys the filter selects, in key order. */
  const matching = async (
    scenario: ScenarioDatabase,
    filter: string,
    libraries: ItemQueryRequest["libraries"] = [personal],
  ) =>
    keys(await result(scenario, { libraries, filter, fields: [], sort: [] }));

  const EVERY_PERSONAL_ITEM = PERSONAL_BY_MODIFIED.toSorted();

  it("returns only the Items the Filter Expression selects", async () => {
    using scenario = openScenarioDatabase();
    expect(await matching(scenario, 'itemType == "book"')).toEqual([
      "BK2MNTH2",
    ]);
    expect(await matching(scenario, "true")).toEqual(EVERY_PERSONAL_ITEM);
    expect(await matching(scenario, "false")).toEqual([]);
  });

  it("reports the filter in the normalized request", async () => {
    using scenario = openScenarioDatabase();
    const filter = ' itemType == "book" ';
    const found = await result(scenario, {
      libraries: [personal],
      filter,
      limit: 1,
    });

    expect(found.query.filter).toBe(filter);
  });

  it.each(["", "   ", "\n"])("fails the empty filter %j", async (filter) => {
    using scenario = openScenarioDatabase();
    const error = await failure(
      scenario,
      { libraries: [personal], filter },
      false,
    );

    expect(error).toMatchObject({
      _tag: "ItemQueryError",
      code: "invalid-filter",
      location: { argument: "filter" },
    });
  });

  it("orders and limits the matches, and projects them", async () => {
    using scenario = openScenarioDatabase();
    const found = await result(scenario, {
      libraries: [personal],
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
    using scenario = openScenarioDatabase();
    const found = await result(scenario, {
      libraries: [personal],
      filter: 'tags.contains("tie")',
      limit: 3,
    });

    expect(found.returnedCount).toBe(3);
    expect(found.truncated).toBe(false);
  });

  describe("exact matching", () => {
    it("matches a Tag by its exact name and keeps the Libraries apart", async () => {
      using scenario = openScenarioDatabase();
      expect(await matching(scenario, 'tags.contains("to-read")')).toEqual([
        "ART2FULL",
        "BK2MNTH2",
      ]);
      expect(await matching(scenario, 'tags.contains("To-Read")')).toEqual([
        "ART2FULL",
      ]);
      expect(await matching(scenario, 'tags.contains("TO-READ")')).toEqual([]);
      expect(
        await matching(scenario, 'tags.contains("to-read")', [group]),
      ).toEqual(["ART2FULLg4815"]);
      expect(await matching(scenario, 'tags.contains("group-only")')).toEqual(
        [],
      );
    });

    it("matches text with its case, and folds case only with lower()", async () => {
      using scenario = openScenarioDatabase();
      expect(await matching(scenario, 'title.contains("Exact")')).toEqual([
        "ART2FULL",
      ]);
      expect(await matching(scenario, 'title.contains("exact")')).toEqual([]);
      expect(
        await matching(scenario, 'title.lower().contains("exact")'),
      ).toEqual(["ART2FULL"]);
      expect(await matching(scenario, 'title.startsWith("Lab")')).toEqual([
        "RPT2NDTE",
      ]);
      expect(await matching(scenario, 'title.endsWith("report")')).toEqual([]);
      expect(await matching(scenario, 'title == "same title"')).toEqual([]);
      expect(await matching(scenario, 'title == "Same Title"')).toEqual([
        "TIE2AAAA",
        "TIE2BBBB",
      ]);
    });

    it("does not normalize Unicode and reads SQL wildcard characters as text", async () => {
      using scenario = openScenarioDatabase();
      // The scenario stores the Tag in its composed form.
      expect(await matching(scenario, 'tags.contains("Éclair")')).toEqual([
        "UNI2CDE2",
      ]);
      expect(await matching(scenario, 'tags.contains("Éclair")')).toEqual([]);
      expect(await matching(scenario, 'title.startsWith("Éclair")')).toEqual(
        [],
      );
      expect(await matching(scenario, 'title.contains("%_")')).toEqual([
        "UNI2CDE2",
      ]);
      expect(await matching(scenario, 'title.contains("_%")')).toEqual([]);
      expect(await matching(scenario, 'title.contains("%")')).toEqual([
        "UNI2CDE2",
      ]);
      expect(
        await matching(scenario, 'tags.contains("100%_raw\\\\path")'),
      ).toEqual(["UNI2CDE2"]);
      expect(
        await matching(scenario, 'tags.contains("100__raw\\\\path")'),
      ).toEqual([]);
      expect(await matching(scenario, 'title.contains("🧪")')).toEqual([
        "UNI2CDE2",
      ]);
      // `lower` gives the Turkish dotted capital I a combining dot.
      expect(
        await matching(scenario, 'title.lower().contains("istanbul")'),
      ).toEqual([]);
      expect(
        await matching(scenario, 'title.lower().contains("i̇stanbul")'),
      ).toEqual(["UNI2CDE2"]);
    });

    it("compares a field value as a string, whether SQLite stores it as text or as a number", async () => {
      using scenario = openScenarioDatabase();
      expect(await matching(scenario, 'volume == "12"')).toEqual([
        "ART2FULL",
        "TIE2AAAA",
        "TIE2BBBB",
      ]);
      expect(await matching(scenario, "volume == 12")).toEqual([]);
      expect(await matching(scenario, "volume > 3")).toEqual([]);
      expect(await matching(scenario, 'volume >= "12"')).toEqual([
        "ART2FULL",
        "TIE2AAAA",
        "TIE2BBBB",
      ]);
    });
  });

  describe("null", () => {
    it("gives a known field that an Item lacks the value null", async () => {
      using scenario = openScenarioDatabase();
      expect(await matching(scenario, "title == null")).toEqual(["TIE2CCCC"]);
      expect(await matching(scenario, 'title != "Same Title"')).toEqual(
        EVERY_PERSONAL_ITEM.filter(
          (key) => key !== "TIE2AAAA" && key !== "TIE2BBBB",
        ),
      );
      expect(await matching(scenario, "volume != null")).toEqual([
        "ART2FULL",
        "TIE2AAAA",
        "TIE2BBBB",
      ]);
    });

    it("treats a null result as no match, and its negation as a match", async () => {
      using scenario = openScenarioDatabase();
      // Null for every Item without a volume.
      expect(await matching(scenario, 'volume < "2"')).toEqual([
        "ART2FULL",
        "TIE2AAAA",
        "TIE2BBBB",
      ]);
      // `!` reads null as falsy.
      expect(await matching(scenario, '!(volume < "2")')).toEqual(
        EVERY_PERSONAL_ITEM.filter(
          (key) => !["ART2FULL", "TIE2AAAA", "TIE2BBBB"].includes(key),
        ),
      );
      expect(await matching(scenario, "!title")).toEqual(["TIE2CCCC"]);
      expect(await matching(scenario, "title.isEmpty()")).toEqual(["TIE2CCCC"]);
    });

    it("gives null for a value that one Item cannot convert, and does not fail the query", async () => {
      using scenario = openScenarioDatabase();
      const { sqlite } = scenario;
      sqlite
        .prepare("insert or ignore into itemDataValues (value) values ('abc')")
        .run();
      sqlite
        .prepare(
          "insert into itemData (itemID, fieldID, valueID) select i.itemID, f.fieldID, v.valueID from items i, fieldsCombined f, itemDataValues v where i.key = 'RPT2NDTE' and i.libraryID = 1 and f.fieldName = 'volume' and f.custom = 0 and v.value = 'abc'",
        )
        .run();

      expect(await matching(scenario, "volume != null")).toEqual([
        "ART2FULL",
        "RPT2NDTE",
        "TIE2AAAA",
        "TIE2BBBB",
      ]);
      expect(await matching(scenario, "number(volume) > 3")).toEqual([
        "ART2FULL",
        "TIE2AAAA",
        "TIE2BBBB",
      ]);
      expect(await matching(scenario, "number(volume) > 12")).toEqual([]);
    });

    it("gives null for a timestamp that cannot be parsed, in projection, filter, and sort", async () => {
      using scenario = openScenarioDatabase();
      scenario.sqlite.exec(
        "update items set dateAdded = 'garbage', dateModified = 'garbage' where key = 'RPT2NDTE' and libraryID = 1",
      );

      const found = await result(scenario, {
        libraries: [personal],
        fields: ["dateAdded", "dateModified"],
        sort: [{ field: "dateAdded", direction: "asc" }],
      });
      expect(found.rows.at(-1)).toEqual({
        indexedKey: "RPT2NDTE",
        values: { dateAdded: null, dateModified: null },
      });
      expect(await matching(scenario, "dateAdded == null")).toEqual([
        "RPT2NDTE",
      ]);
      expect(await matching(scenario, "dateModified == null")).toEqual([
        "RPT2NDTE",
      ]);
      expect(
        await matching(scenario, 'dateAdded < date("2000-01-01")'),
      ).toEqual([]);
      expect(
        await matching(scenario, 'dateModified < date("2000-01-01")'),
      ).toEqual([]);
    });
  });

  describe("dates and the Query Clock", () => {
    /** The keys the filter selects at one instant in one time zone. */
    const matchingAt = async (
      scenario: ScenarioDatabase,
      filter: string,
      clock: { now: string; timeZone: string },
    ) => {
      const { exit } = await runEffect(
        collectQuery(ITEMS, {
          libraries: [personal],
          filter,
          fields: [],
          sort: [],
        }),
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
      using scenario = openScenarioDatabase();
      // BK2MNTH2 was added at 06:00Z (01:00 local on 7 January), CNF2TEXT at
      // 04:00Z (23:00 local on 6 January).
      expect(
        await matchingAt(scenario, "dateAdded >= today()", NEW_YORK),
      ).toEqual([
        "ALS2CNFL",
        "ART2FULL",
        "BK2MNTH2",
        "RPT2NDTE",
        "TIE2AAAA",
        "TIE2BBBB",
        "TIE2CCCC",
        "UNI2CDE2",
      ]);
      expect(
        await matchingAt(scenario, "today() == now().date()", NEW_YORK),
      ).toEqual(EVERY_PERSONAL_ITEM);
    });

    it("gives every call in one query the same instant", async () => {
      using scenario = openScenarioDatabase();
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
          collectQuery(ITEMS, {
            libraries: [personal],
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
      using scenario = openScenarioDatabase();
      const filter = "dateAdded >= today()";

      expect(
        await matchingAt(scenario, filter, {
          ...NEW_YORK,
          now: "2024-02-29T23:00:00Z",
        }),
      ).toEqual(["UNI2CDE2"]);
      expect(
        await matchingAt(scenario, filter, {
          ...NEW_YORK,
          now: "2024-03-01T05:00:00Z",
        }),
      ).toEqual([]);
    });

    it("gives .date() of a timestamp the calendar day of the query time zone", async () => {
      using scenario = openScenarioDatabase();
      expect(
        await matchingAt(
          scenario,
          'dateAdded.date() == date("2020-01-06")',
          NEW_YORK,
        ),
      ).toEqual(["CNF2TEXT"]);
      expect(
        await matchingAt(scenario, 'dateAdded.date() == date("2020-01-06")', {
          ...NEW_YORK,
          timeZone: "UTC",
        }),
      ).toEqual([]);
    });

    it("computes a window from now() with a duration", async () => {
      using scenario = openScenarioDatabase();
      expect(
        await matchingAt(
          scenario,
          'dateAdded > now() - duration("1d") && dateAdded < now()',
          NEW_YORK,
        ),
      ).toEqual(["BK2MNTH2", "CNF2TEXT"]);
    });

    it("compares partial dates as the interval of days each one covers", async () => {
      using scenario = openScenarioDatabase();
      // ART2FULL 2020-03-15, ALS2CNFL 2021-06-30, UNI2CDE2 2024-02-29,
      // TIE2* 2021, BK2MNTH2 2019-11, CHP2YEAR 2018; CNF2TEXT has a text date
      // without a year and RPT2NDTE no date.
      expect(
        await matchingAt(scenario, 'date >= date("2020")', NEW_YORK),
      ).toEqual([
        "ALS2CNFL",
        "ART2FULL",
        "TIE2AAAA",
        "TIE2BBBB",
        "TIE2CCCC",
        "UNI2CDE2",
      ]);
      expect(
        await matchingAt(scenario, 'date == date("2019-11-30")', NEW_YORK),
      ).toEqual(["BK2MNTH2"]);
      expect(
        await matchingAt(scenario, 'date == date("2021-06")', NEW_YORK),
      ).toEqual(["ALS2CNFL", "TIE2AAAA", "TIE2BBBB", "TIE2CCCC"]);
      expect(
        await matchingAt(scenario, 'date <= date("2018-01-01")', NEW_YORK),
      ).toEqual(["CHP2YEAR"]);
      expect(
        await matchingAt(scenario, 'date > date("2018-12-31")', NEW_YORK),
      ).toEqual([
        "ALS2CNFL",
        "ART2FULL",
        "BK2MNTH2",
        "TIE2AAAA",
        "TIE2BBBB",
        "TIE2CCCC",
        "UNI2CDE2",
      ]);
      expect(
        await matchingAt(scenario, 'date == date("2024-02-29")', NEW_YORK),
      ).toEqual(["UNI2CDE2"]);
      expect(await matchingAt(scenario, "date == null", NEW_YORK)).toEqual([
        "CNF2TEXT",
        "RPT2NDTE",
      ]);
    });

    it("reads a text date by the year in its text, and accessDate as a UTC timestamp", async () => {
      using scenario = openScenarioDatabase();
      setField(scenario, "RPT2NDTE", ["date", "0000-00-00 circa 1850"]);
      // 03:00Z on 16 March is 23:00 on 15 March in New York.
      setField(scenario, "ART2FULL", ["accessDate", "2020-03-16 03:00:00"]);

      expect(
        await matchingAt(scenario, 'date == date("1850")', NEW_YORK),
      ).toEqual(["RPT2NDTE"]);
      expect(
        await matchingAt(
          scenario,
          'accessDate.date() == date("2020-03-15")',
          NEW_YORK,
        ),
      ).toEqual(["ART2FULL"]);
      expect(
        await matchingAt(
          scenario,
          'accessDate == date("2020-03-16 03:00:00Z")',
          NEW_YORK,
        ),
      ).toEqual(["ART2FULL"]);
    });
  });

  describe("names", () => {
    it("resolves a base field through the type-specific field of each item type", async () => {
      using scenario = openScenarioDatabase();
      expect(
        await matching(scenario, 'publicationTitle == "Handbook of Methods"'),
      ).toEqual(["CHP2YEAR"]);
      expect(
        await matching(
          scenario,
          'publicationTitle == "Proceedings of Testing"',
        ),
      ).toEqual(["CNF2TEXT"]);
      expect(
        await matching(scenario, 'bookTitle == "Handbook of Methods"'),
      ).toEqual(["CHP2YEAR"]);
      expect(await matching(scenario, 'publisher == "Lab Institute"')).toEqual([
        "RPT2NDTE",
      ]);
      expect(await matching(scenario, "proceedingsTitle != null")).toEqual([
        "CNF2TEXT",
      ]);
    });

    it("reads the built-in field for a bare name that a custom field also has", async () => {
      using scenario = openScenarioDatabase();
      // The type-specific field wins over the stored base field; the custom
      // field of the same name is reached only through custom[...].
      expect(
        await matching(scenario, 'publicationTitle == "Type-Specific Host"'),
      ).toEqual(["ALS2CNFL"]);
      expect(
        await matching(scenario, 'publicationTitle == "Custom Host"'),
      ).toEqual([]);
      expect(
        await matching(scenario, 'custom["publicationTitle"] == "Custom Host"'),
      ).toEqual(["ALS2CNFL"]);
      expect(await matching(scenario, 'title == "Custom Title Value"')).toEqual(
        [],
      );
      expect(
        await matching(scenario, 'custom["title"] == "Custom Title Value"'),
      ).toEqual(["ART2FULL"]);
    });

    it("reaches a custom field by its exact name and by an eligible bare name", async () => {
      using scenario = openScenarioDatabase();
      expect(
        await matching(scenario, 'custom["review.status"] == "done"'),
      ).toEqual(["ART2FULL"]);
      expect(
        await matching(scenario, 'custom["review.status"] != null'),
      ).toEqual(["ART2FULL", "BK2MNTH2"]);
      expect(
        await matching(scenario, 'custom["review.status"].isEmpty()'),
      ).toEqual(EVERY_PERSONAL_ITEM.filter((key) => key !== "ART2FULL"));
      expect(await matching(scenario, 'mood == "calm"')).toEqual(["ART2FULL"]);
      expect(await matching(scenario, 'custom.mood == "calm"')).toEqual([
        "ART2FULL",
      ]);
      expect(await matching(scenario, 'custom["mood"] == "Calm"')).toEqual([]);
    });

    it.each([
      // Field lookup is case-sensitive.
      ['Mood == "calm"', [0, 4]],
      ['Title == "x"', [0, 5]],
      ['true && noSuchField == "x"', [8, 19]],
    ])("fails the unknown bare name in %j", async (filter, [from, to]) => {
      using scenario = openScenarioDatabase();
      const error = await failure(scenario, {
        libraries: [personal],
        filter,
      });

      expect(error).toMatchObject({
        _tag: "ItemQueryError",
        code: "unknown-field",
        location: { argument: "filter", span: { from, to } },
      });
    });

    it("fails a custom field that the source does not define", async () => {
      using scenario = openScenarioDatabase();
      const error = await failure(scenario, {
        libraries: [personal],
        filter: 'itemType == "book" || custom["Review.Status"] == "done"',
      });

      expect(error).toMatchObject({
        _tag: "ItemQueryError",
        code: "unknown-field",
        location: { argument: "filter", span: { from: 22, to: 45 } },
      });
    });
  });

  describe("relation lists", () => {
    it("keeps one creator element for each source row", async () => {
      using scenario = openScenarioDatabase();
      expect(await matching(scenario, "creators.length == 2")).toEqual([
        "ART2FULL",
        "BK2MNTH2",
        "CHP2YEAR",
      ]);
      // The same person as author and as editor.
      expect(
        await matching(
          scenario,
          'creators == ["Grace Hopper", "Grace Hopper"]',
        ),
      ).toEqual(["BK2MNTH2"]);
      expect(await matching(scenario, 'creators == ["Grace Hopper"]')).toEqual(
        [],
      );
      expect(
        await matching(scenario, 'creators.contains("Grace Hopper")'),
      ).toEqual(["BK2MNTH2", "CHP2YEAR"]);
      expect(
        await matching(
          scenario,
          'creators.contains("World Health Organization")',
        ),
      ).toEqual(["ART2FULL"]);
      expect(await matching(scenario, 'creators[0] == "Alan Turing"')).toEqual([
        "CHP2YEAR",
      ]);
      expect(await matching(scenario, "creators.isEmpty()")).toEqual([
        "ALS2CNFL",
        "RPT2NDTE",
        "TIE2CCCC",
      ]);
    });

    it("matches a Collection by its root-first path", async () => {
      using scenario = openScenarioDatabase();
      expect(
        await matching(scenario, 'collections.contains("Thesis/Methods")'),
      ).toEqual(["ART2FULL", "CHP2YEAR"]);
      expect(
        await matching(scenario, 'collections.contains("Teaching/Methods")'),
      ).toEqual(["BK2MNTH2"]);
      // Two Collections share the leaf name; the leaf name alone is no path.
      expect(
        await matching(scenario, 'collections.contains("Methods")'),
      ).toEqual([]);
      expect(
        await matching(scenario, 'collections.contains("Thesis")'),
      ).toEqual(["CHP2YEAR"]);
      expect(
        await matching(scenario, 'collections.contains("Methods")', [group]),
      ).toEqual(["GRP2BK22g4815"]);
      expect(await matching(scenario, "collections.length == 2")).toEqual([
        "CHP2YEAR",
      ]);
    });

    it("matches a subtree with within", async () => {
      using scenario = openScenarioDatabase();
      expect(await matching(scenario, 'collections.within("Thesis")')).toEqual([
        "ART2FULL",
        "CHP2YEAR",
      ]);
      expect(
        await matching(scenario, 'collections.within("Thesis/Methods")'),
      ).toEqual(["ART2FULL", "CHP2YEAR"]);
      expect(
        await matching(scenario, 'collections.within("Teaching")'),
      ).toEqual(["BK2MNTH2"]);
      expect(await matching(scenario, 'collections.within("Methods")')).toEqual(
        [],
      );
      expect(await matching(scenario, 'collections.within("Thes")')).toEqual(
        [],
      );
    });

    it("leaves out a trashed Collection and every Collection below it", async () => {
      using scenario = openScenarioDatabase();
      expect(await matching(scenario, 'collections.within("Archive")')).toEqual(
        [],
      );
      expect(
        await matching(scenario, 'collections.contains("Archive/Old")'),
      ).toEqual([]);
      expect(await matching(scenario, 'collections.contains("Old")')).toEqual(
        [],
      );
    });

    it("reads Attachment presence as a boolean", async () => {
      using scenario = openScenarioDatabase();
      expect(await matching(scenario, "attachments")).toEqual(["ART2FULL"]);
      expect(await matching(scenario, "!attachments")).toEqual(
        EVERY_PERSONAL_ITEM.filter((key) => key !== "ART2FULL"),
      );
    });

    it("matches the Zotero Key inside the Target Library", async () => {
      using scenario = openScenarioDatabase();
      expect(await matching(scenario, 'key == "ART2FULL"')).toEqual([
        "ART2FULL",
      ]);
      expect(await matching(scenario, 'key == "ART2FULL"', [group])).toEqual([
        "ART2FULLg4815",
      ]);
      expect(await matching(scenario, 'key == "GRP2BK22"')).toEqual([]);
      expect(await matching(scenario, 'key == "TRS2SHED"')).toEqual([]);
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
        using scenario = openScenarioDatabase();
        const error = await failure(
          scenario,
          { libraries: [personal], filter },
          false,
        );

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
      using scenario = openScenarioDatabase();
      scenario.sqlite.exec("delete from items where libraryID = 2");

      const error = await failure(scenario, {
        libraries: [group],
        filter: "title.startsWith(1)",
      });

      expect(error).toMatchObject({ code: "wrong-argument-type" });
    });
  });
});

describe("collectQuery(ITEMS) candidate sets", () => {
  /**
   * Run a filter on the personal Library, and give its Indexed Keys in key
   * order and the keys of the Items that the hydrate statements of `kind`
   * loaded. A filter here reads one relation at most, so the relation
   * statements load the Tags or the Collections that the filter reads.
   */
  const hydratedReads =
    (kind: "fields" | "relation") =>
    async (filter: string, tuning?: RunOptions["tuning"]) => {
      using scenario = openScenarioDatabase();
      const { exit, events } = await runEffect(
        collectQuery(ITEMS, {
          libraries: [personal],
          filter,
          fields: [],
          sort: [],
        }),
        { client: scenario.db, tuning },
      );
      if (!Exit.isSuccess(exit)) throw new Error(String(exit.cause));
      const keyOf = scenario.sqlite.prepare(
        "select key from items where itemID = ?",
      );
      return {
        matched: keys(exit.value),
        read: [...new Set(hydrates(events, kind).flatMap(itemIDsBound))]
          .map((itemID) => (keyOf.get(itemID) as { key: string }).key)
          .toSorted(),
      };
    };
  const tagReads = hydratedReads("relation");
  const fieldReads = hydratedReads("fields");
  const collectionReads = hydratedReads("relation");

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
    // accessDate is a date, not stored text.
    'accessDate == "2020-01-07"',
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
    using scenario = openScenarioDatabase();
    // The Tag `methods` on four more Items: five in total, above the cap of 3.
    scenario.sqlite.exec(
      `insert into itemTags (itemID, tagID, type)
       select itemID, (select tagID from tags where name = 'methods'), 0
       from items where key in ('TIE2AAAA', 'TIE2BBBB', 'RPT2NDTE', 'CNF2TEXT') and libraryID = 1`,
    );
    const { exit, events } = await run(scenario, {
      libraries: [personal],
      filter: 'tags.contains("methods") && tags.contains("tie")',
      fields: [],
      sort: [],
    });

    if (!Exit.isSuccess(exit)) throw new Error(String(exit.cause));
    expect(keys(exit.value)).toEqual(["TIE2AAAA", "TIE2BBBB"]);
    expect(
      new Set(hydrates(events, "relation").flatMap(itemIDsBound)).size,
    ).toBe(3);
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
    using scenario = openScenarioDatabase();
    const matching = async (
      scenario: ScenarioDatabase,
      filter: string,
      libraries: ItemQueryRequest["libraries"],
    ) =>
      keys(await result(scenario, { libraries, filter, fields: [], sort: [] }));

    // `to-read` and the key ART2FULL exist in both Libraries.
    expect(
      await matching(scenario, 'tags.contains("to-read")', [group]),
    ).toEqual(["ART2FULLg4815"]);
    expect(await matching(scenario, 'key == "ART2FULL"', [group])).toEqual([
      "ART2FULLg4815",
    ]);
    expect(await matching(scenario, 'key == "ART2FULL"', [personal])).toEqual([
      "ART2FULL",
    ]);
    // `group-only` and GRP2BK22 exist in the group Library only.
    expect(
      await matching(scenario, 'tags.contains("group-only")', [personal]),
    ).toEqual([]);
    expect(await matching(scenario, 'key == "GRP2BK22"', [personal])).toEqual(
      [],
    );
    expect(
      await matching(
        scenario,
        'tags.contains("group-only") || key == "GRP2BK22"',
        [group],
      ),
    ).toEqual(["GRP2BK22g4815"]);
  });

  it("reads a candidate set that is larger than one universe chunk and one hydrate chunk", async () => {
    using scenario = openScenarioDatabase();
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
    const { exit, events } = await run(scenario, {
      libraries: [personal],
      filter: 'tags.contains("group-only")',
      fields: [],
      sort: [],
    });

    if (!Exit.isSuccess(exit)) throw new Error(String(exit.cause));
    const found = exit.value;
    expect(found.returnedCount).toBe(700);
    expect(keys(found).at(0)).toBe("ZZ000000");
    expect(keys(found).at(-1)).toBe("ZZ000699");
    expect(
      new Set(hydrates(events, "relation").flatMap(itemIDsBound)).size,
    ).toBe(700);
  });
});

describe("collectQuery(ITEMS) over several Libraries", () => {
  const both = [personal, group];
  /** Both Libraries, most recently modified first. */
  const BOTH_BY_MODIFIED = [
    "ART2FULLg4815",
    "ART2FULL",
    "GRP2BK22g4815",
    ...PERSONAL_BY_MODIFIED.slice(1),
  ];
  /** The Indexed Keys the filter selects in the Libraries, in key order. */
  const matching = async (
    scenario: ScenarioDatabase,
    filter: string,
    libraries: ItemQueryRequest["libraries"] = both,
  ) =>
    keys(await result(scenario, { libraries, filter, fields: [], sort: [] }));

  /** File the personal Item RPT2NDTE in a top-level Collection `Methods`. */
  function filePersonalMethods(scenario: ScenarioDatabase): void {
    scenario.sqlite.exec(
      `insert into collections (collectionName, parentCollectionID, clientDateModified, libraryID, key)
       values ('Methods', null, '2024-01-01 00:00:00', 1, 'CL2PRMTH');
       insert into collectionItems (collectionID, itemID, orderIndex)
       select c.collectionID, i.itemID, 0 from collections c, items i
       where c.key = 'CL2PRMTH' and i.key = 'RPT2NDTE' and i.libraryID = 1`,
    );
  }

  it("orders the Items of the Libraries as one result set", async () => {
    using scenario = openScenarioDatabase();
    const found = await result(scenario, { libraries: both });

    expect(keys(found)).toEqual(BOTH_BY_MODIFIED);
    expect(found.returnedCount).toBe(12);
    expect(found.truncated).toBe(false);
  });

  it("gives the same result for each order of the Libraries in the request", async () => {
    using scenario = openScenarioDatabase();
    const request = { fields: ["title", "collections"], limit: 5 };

    expect(
      await result(scenario, { ...request, libraries: [group, personal] }),
    ).toEqual(await result(scenario, { ...request, libraries: both }));
  });

  it("breaks a tie between two Libraries by the Indexed Key", async () => {
    using scenario = openScenarioDatabase();
    const inKeyOrder = await result(scenario, {
      libraries: [group, personal],
      fields: [],
      sort: [],
    });
    // ART2FULL has the same date in both Libraries.
    const byDate = await result(scenario, {
      libraries: [group, personal],
      filter: 'date == date("2020-03-15")',
      fields: [],
      sort: [{ field: "date", direction: "desc" }],
    });

    expect(keys(inKeyOrder)).toEqual([
      "ALS2CNFL",
      "ART2FULL",
      "ART2FULLg4815",
      "BK2MNTH2",
      "CHP2YEAR",
      "CNF2TEXT",
      "GRP2BK22g4815",
      "RPT2NDTE",
      "TIE2AAAA",
      "TIE2BBBB",
      "TIE2CCCC",
      "UNI2CDE2",
    ]);
    expect(keys(byDate)).toEqual(["ART2FULL", "ART2FULLg4815"]);
  });

  it.each([
    [1, true],
    [2, true],
    [3, true],
    [11, true],
    [12, false],
    [13, false],
  ])(
    "takes the first %i rows of the one result set and reports truncated %j",
    async (limit, truncated) => {
      using scenario = openScenarioDatabase();
      const found = await result(scenario, { libraries: both, limit });

      expect(keys(found)).toEqual(BOTH_BY_MODIFIED.slice(0, limit));
      expect(found.returnedCount).toBe(Math.min(limit, 12));
      expect(found.truncated).toBe(truncated);
    },
  );

  it("filters and projects the Library selector of Items with the same bare key", async () => {
    using scenario = openScenarioDatabase();
    const request = {
      libraries: both,
      fields: ["title", "library"],
      sort: [],
    };
    const found = await result(scenario, {
      ...request,
      filter: 'key == "ART2FULL"',
    });
    expect(found.rows).toEqual([
      {
        indexedKey: "ART2FULL",
        values: {
          title: "Exact Matching in Literature Review",
          library: "personal",
        },
      },
      {
        indexedKey: "ART2FULLg4815",
        values: {
          title: "Group Copy of Exact Matching",
          library: "group:4815",
        },
      },
    ]);
    for (const [filter, expected] of [
      ['library == "personal"', "personal"],
      ['library != "personal"', "group:4815"],
      ['library == "group:4815"', "group:4815"],
    ]) {
      const selected = await result(scenario, { ...request, filter });
      expect(selected.rows.length).toBeGreaterThan(0);
      expect(new Set(selected.rows.map((row) => row.values.library))).toEqual(
        new Set([expected]),
      );
      expect(keys(selected)).toEqual(
        keys(
          await result(scenario, {
            ...request,
            libraries: [expected === "personal" ? personal : group],
          }),
        ),
      );
    }
  });

  it("matches a Zotero Key in each Library that holds it", async () => {
    using scenario = openScenarioDatabase();

    expect(await matching(scenario, 'key == "ART2FULL"')).toEqual([
      "ART2FULL",
      "ART2FULLg4815",
    ]);
    expect(await matching(scenario, 'key == "GRP2BK22"')).toEqual([
      "GRP2BK22g4815",
    ]);
  });

  it("matches a Tag in each Library that holds it", async () => {
    using scenario = openScenarioDatabase();

    expect(await matching(scenario, 'tags.contains("to-read")')).toEqual([
      "ART2FULL",
      "ART2FULLg4815",
      "BK2MNTH2",
    ]);
    expect(await matching(scenario, 'tags.contains("group-only")')).toEqual([
      "GRP2BK22g4815",
    ]);
  });

  it("matches a Collection path in each Library that holds it", async () => {
    using scenario = openScenarioDatabase();
    filePersonalMethods(scenario);
    const filter = 'collections.contains("Methods")';

    expect(await matching(scenario, filter)).toEqual([
      "GRP2BK22g4815",
      "RPT2NDTE",
    ]);
    expect(await matching(scenario, filter, [personal])).toEqual(["RPT2NDTE"]);
    expect(await matching(scenario, filter, [group])).toEqual([
      "GRP2BK22g4815",
    ]);
    // `Thesis/Methods` is a path of the personal Library only.
    expect(await matching(scenario, 'collections.within("Thesis")')).toEqual([
      "ART2FULL",
      "CHP2YEAR",
    ]);
  });

  it("projects the Collections of each Item from its own Library", async () => {
    using scenario = openScenarioDatabase();
    filePersonalMethods(scenario);
    const found = await result(scenario, {
      libraries: both,
      filter: 'key == "ART2FULL" || key == "GRP2BK22" || key == "RPT2NDTE"',
      fields: ["title", "collections", "tags[0].name"],
      sort: [],
    });

    expect(found.rows).toEqual([
      {
        indexedKey: "ART2FULL",
        values: {
          title: "Exact Matching in Literature Review",
          collections: ["Thesis/Methods"],
          "tags[0].name": "methods",
        },
      },
      {
        indexedKey: "ART2FULLg4815",
        values: {
          title: "Group Copy of Exact Matching",
          collections: [],
          "tags[0].name": "to-read",
        },
      },
      {
        indexedKey: "GRP2BK22g4815",
        values: {
          title: "Group Methods Book",
          collections: ["Methods"],
          "tags[0].name": "group-only",
        },
      },
      {
        indexedKey: "RPT2NDTE",
        values: {
          title: "Lab Report",
          collections: ["Methods"],
          "tags[0].name": null,
        },
      },
    ]);
  });

  it("measures a candidate set against the cap of its own Library", async () => {
    using scenario = openScenarioDatabase();
    // `to-read`: 3 of the 15 personal `items` rows, within the cap of 3; 1 of
    // the 3 group rows, above the cap of 0.
    const { exit, events } = await run(scenario, {
      libraries: both,
      filter: 'tags.contains("to-read")',
      fields: [],
      sort: [],
    });

    if (!Exit.isSuccess(exit)) throw new Error(String(exit.cause));
    expect(keys(exit.value)).toEqual(["ART2FULL", "ART2FULLg4815", "BK2MNTH2"]);
    /** The Items that the statements of one reader read, by Library. */
    const itemsOf = (reader: string) =>
      events.flatMap((event) =>
        event.type === "statement" && event.statement.reader === reader
          ? (event.statement.rows as { key: string }[]).map(
              (row) => `${String(event.statement.params.libraryID)}/${row.key}`,
            )
          : [],
      );
    // The live personal candidates, and every live top-level group Item.
    expect(itemsOf("universe-rows")).toEqual(["1/ART2FULL", "1/BK2MNTH2"]);
    expect(itemsOf("scan-page")).toEqual(["2/ART2FULL", "2/GRP2BK22"]);
  });

  it("orders the same Zotero Key of two groups by the text of the Indexed Key", async () => {
    using scenario = openScenarioDatabase();
    // Two more groups that hold ART2FULL: the group IDs 9 and 10.
    const groups = [9, 10].map((groupID) => {
      const libraryID = 100 + groupID;
      scenario.sqlite.exec(
        `insert into libraries (libraryID, type, editable, filesEditable) values (${libraryID}, 'group', 1, 1);
         insert into groups (groupID, libraryID, name, description, version) values (${groupID}, ${libraryID}, 'Group ${groupID}', '', 0);
         insert into items (itemTypeID, libraryID, key) select itemTypeID, ${libraryID}, 'ART2FULL' from itemTypesCombined where typeName = 'book'`,
      );
      return { libraryID, groupID };
    });

    // In text order, `g10` comes before `g4815` and `g9`.
    expect(
      await matching(scenario, 'key == "ART2FULL"', [...groups, ...both]),
    ).toEqual(["ART2FULL", "ART2FULLg10", "ART2FULLg4815", "ART2FULLg9"]);
  });

  it("reads no Item of a Library outside the request", async () => {
    using scenario = openScenarioDatabase();
    seedBulkLibrary(scenario.sqlite, 3);

    expect(await matching(scenario, "true")).toHaveLength(12);
    expect(await matching(scenario, `tags.contains("${BULK_TAG}")`)).toEqual(
      [],
    );
  });
});

// Delivery failure modes: reordered/missing rows, shared state on rerun,
// incorrect empty/truncated metadata, and reads continuing after a failed write.
describe("incremental query consumption", () => {
  it.each([
    { libraries: [personal, group], limit: null },
    { libraries: [personal, group], limit: 2 },
    { libraries: [personal], filter: "false" },
  ])(
    "matches the complete result for %j on every execution",
    async (request) => {
      using scenario = openScenarioDatabase();
      const expected = await result(scenario, request);
      const operation = consumeQuery(ITEMS, request, (summary) =>
        Effect.sync(() => {
          const rows: QueryRow[] = [];
          return {
            write: (chunk) =>
              Effect.sync(() => {
                expect(chunk.length).toBeLessThanOrEqual(2);
                rows.push(...chunk);
              }),
            end: () => Effect.succeed({ ...summary, rows }),
          };
        }),
      );
      for (let run = 0; run < 2; run++) {
        const { exit } = await runEffect(operation, {
          client: scenario.db,
          tuning: { hydrateChunkSize: 2 },
        });
        expect(Exit.isSuccess(exit) && exit.value).toEqual(expected);
      }
    },
  );

  it("awaits a write and stops projection when that write fails", async () => {
    using scenario = openScenarioDatabase();
    // The Item IDs of the field-value statements, when each one runs.
    const ids: number[] = [];
    const hydrated = () => [...ids];
    const failed = { reason: "destination is full" };
    let finishWrite!: () => void;
    const blocked = new Promise<void>((resolve) => {
      finishWrite = resolve;
    });
    let beganWrite!: () => void;
    const writing = new Promise<void>((resolve) => {
      beganWrite = resolve;
    });
    let ended = false;
    const running = runEffect(
      consumeQuery(
        ITEMS,
        { libraries: [personal], fields: ["title"], sort: [], limit: null },
        () =>
          Effect.succeed({
            write: () =>
              Effect.promise(async () => {
                beganWrite();
                await blocked;
              }).pipe(Effect.andThen(Effect.fail(failed))),
            end: () =>
              Effect.sync(() => {
                ended = true;
              }),
          }),
      ),
      {
        client: scenario.db,
        tuning: { hydrateChunkSize: 1 },
        onEvent: (event) => {
          if (event.type !== "statement") return;
          ids.push(...hydrates([event], "fields").flatMap(itemIDsBound));
        },
      },
    );
    await writing;
    const reads = hydrated();
    expect(reads).toHaveLength(1);
    expect(hydrated()).toEqual(reads);
    finishWrite();
    const { exit } = await running;
    expect(
      Exit.isFailure(exit) && Cause.findErrorOption(exit.cause),
    ).toMatchObject({ _tag: "Some", value: failed });
    expect(hydrated()).toEqual(reads);
    expect(ended).toBe(false);
  });
});

/** The facts of a request that hold for each Query Dataset. */
interface DatasetCase {
  readonly dataset: QueryDataset<ItemQueryRequest>;
  readonly scenario: { readonly annotations: boolean };
  readonly defaults: Pick<ItemQuery, "fields" | "sort">;
  /** Two Projection Paths, and two Sortable Fields, of the dataset. */
  readonly fields: readonly string[];
  readonly sort: readonly SortSpec[];
  /** Invalid Projection Paths and the code of each. */
  readonly paths: readonly (readonly [string, ItemQueryErrorCode])[];
  /** Invalid Sortable Fields and the code of each. */
  readonly sortFields: readonly (readonly [string, ItemQueryErrorCode])[];
}

const DATASETS: readonly DatasetCase[] = [
  {
    dataset: ITEMS,
    scenario: { annotations: false },
    defaults: {
      fields: ["itemType", "title", "creators", "date", "dateModified"],
      sort: [{ field: "dateModified", direction: "desc" }],
    },
    fields: ["dateAdded", "itemType"],
    sort: [
      { field: "publicationTitle", direction: "desc" },
      { field: "date", direction: "asc" },
    ],
    paths: [
      ["date.", "invalid-path"],
      ["custom[review]", "invalid-path"],
      ['custom["unterminated]', "invalid-path"],
      ["title]", "invalid-path"],
      ["", "invalid-path"],
      ["[0]", "unknown-field"],
      ["mood", "unknown-field"],
      ["Title", "unknown-field"],
      ["date.century", "unknown-path"],
      ["title.length", "unknown-path"],
      ["date[0]", "unknown-path"],
      ["custom[0]", "unknown-path"],
      ["creators[ ]", "invalid-path"],
      ["title[]", "unknown-path"],
      // Array access does not vectorize.
      ["creators.fullName", "unknown-path"],
      ["tags.name", "unknown-path"],
      ["creators[0].name", "unknown-path"],
      ["collections[0].name", "unknown-path"],
      ["attachments[0]", "unknown-path"],
    ],
    sortFields: [
      ["noSuchField", "unknown-field"],
      ["Title", "unknown-field"],
      ["", "unknown-field"],
      ["custom", "unsortable-field"],
      ['custom["mood"]', "unsortable-field"],
      ["date.year", "unsortable-field"],
      ["creators[].fullName", "unsortable-field"],
    ],
  },
  {
    dataset: ANNOTATIONS,
    scenario: { annotations: true },
    defaults: {
      fields: [
        "type",
        "text",
        "comment",
        "color",
        "colorName",
        "pageLabel",
        "pageIndex",
        "tags",
        "dateAdded",
        "dateModified",
        "hasExcerptImage",
        "attachment",
        "item.title",
        "item.citationKey",
      ],
      sort: [
        { field: "item.dateModified", direction: "desc" },
        { field: "attachment.indexedKey", direction: "asc" },
        { field: "sortIndex", direction: "asc" },
      ],
    },
    fields: ["type", "item.title"],
    sort: [
      { field: "type", direction: "desc" },
      { field: "attachment.indexedKey", direction: "asc" },
    ],
    paths: [
      ["text.", "invalid-path"],
      ['item.custom["unterminated]', "invalid-path"],
      ["item.title]", "invalid-path"],
      ["", "invalid-path"],
      ["[0]", "unknown-field"],
      ["missing", "unknown-field"],
      ["Text", "unknown-field"],
      ["item.noSuchField", "unknown-field"],
      ["attachment.missing", "unknown-path"],
      ["item.date.century", "unknown-path"],
      ["tags.name", "unknown-path"],
      ["item.creators.fullName", "unknown-path"],
      ["item.title[]", "unknown-path"],
    ],
    sortFields: [
      ["noSuchField", "unknown-field"],
      ["Type", "unknown-field"],
      ["", "unknown-field"],
      ["text", "unsortable-field"],
      ["attachment.title", "unsortable-field"],
      ["item.date.year", "unsortable-field"],
      ["item.creators[].fullName", "unsortable-field"],
    ],
  },
];

describe.each(DATASETS)(
  "$dataset.family request",
  ({
    dataset,
    scenario: options,
    defaults,
    fields,
    sort,
    paths,
    sortFields,
  }) => {
    const open = () => openScenarioDatabase(options);
    const request = (rest: Omit<ItemQueryRequest, "libraries"> = {}) => ({
      libraries: [personal],
      ...rest,
    });

    async function datasetResult(
      scenario: ScenarioDatabase,
      query: ItemQueryRequest,
    ): Promise<QueryResult> {
      const { exit } = await runEffect(collectQuery(dataset, query), {
        client: scenario.db,
      });
      if (!Exit.isSuccess(exit)) throw new Error(String(exit.cause));
      return exit.value;
    }

    /** The typed failure of a run without a database: it reads nothing. */
    async function requestFailure(query: ItemQueryRequest) {
      const { exit, events } = await runEffect(collectQuery(dataset, query));
      if (!Exit.isFailure(exit)) throw new Error("the query did not fail.");
      const error = Cause.findErrorOption(exit.cause);
      if (error._tag === "None") throw new Error(String(exit.cause));
      expect(events.filter((event) => event.type === "statement")).toEqual([]);
      expect(error.value).toBeInstanceOf(ItemQueryError);
      expect(error.value).toMatchObject({ dataset });
      return error.value as ItemQueryError;
    }

    describe("normalized request", () => {
      it("reports the defaults it applied", async () => {
        using scenario = open();
        const found = await datasetResult(scenario, request());

        expect(found.query).toEqual({
          filter: null,
          fields: defaults.fields,
          sort: defaults.sort,
          limit: null,
        });
      });

      it("reports the fields, the sort, and the limit the caller gave", async () => {
        using scenario = open();
        const found = await datasetResult(
          scenario,
          request({ fields, sort, limit: 4 }),
        );

        expect(found.query).toEqual({ filter: null, fields, sort, limit: 4 });
      });

      it("gives the same rows when the caller sends the normalized request back", async () => {
        using scenario = open();
        const libraries = [personal, group];
        const first = await datasetResult(scenario, { libraries });
        const { filter, ...query } = first.query;
        const replay = await datasetResult(scenario, {
          ...query,
          ...(filter === null ? {} : { filter }),
          libraries,
        });

        expect(first.rows.length).toBeGreaterThan(1);
        expect(replay.query).toEqual(first.query);
        expect(replay.rows).toEqual(first.rows);
      });
    });

    describe("limit", () => {
      it("gives the same rows for every limit as the start of the unlimited result", async () => {
        using scenario = open();
        const all = await datasetResult(scenario, request({ sort }));
        const count = all.rows.length;
        expect(count).toBeGreaterThan(2);

        for (const limit of [1, count - 1, count, count + 1]) {
          const limited = await datasetResult(
            scenario,
            request({ sort, limit }),
          );
          expect(limited.rows).toEqual(all.rows.slice(0, limit));
          expect(limited.returnedCount).toBe(Math.min(limit, count));
          expect(limited.truncated).toBe(limit < count);
        }
      });

      it.each([undefined, null])(
        "returns every match with the limit %s",
        async (limit) => {
          using scenario = open();
          const all = await datasetResult(scenario, request({ fields: [] }));
          const found = await datasetResult(
            scenario,
            request({ fields: [], limit }),
          );

          expect(found.returnedCount).toBe(all.rows.length);
          expect(found.truncated).toBe(false);
        },
      );

      it("returns no rows from a Library without records", async () => {
        using scenario = open();
        const found = await datasetResult(scenario, {
          libraries: [{ libraryID: 9999, groupID: null }],
          limit: 3,
        });

        expect(found).toMatchObject({
          rows: [],
          returnedCount: 0,
          truncated: false,
        });
      });
    });

    describe("projection", () => {
      it("returns identity-only rows for an empty field list", async () => {
        using scenario = open();
        const found = await datasetResult(
          scenario,
          request({ fields: [], limit: 2 }),
        );

        expect(found.rows).toHaveLength(2);
        for (const row of found.rows) expect(row.values).toEqual({});
      });

      it("puts every requested field in each row", async () => {
        using scenario = open();
        const found = await datasetResult(scenario, request({ fields }));

        expect(found.rows.length).toBeGreaterThan(0);
        for (const row of found.rows)
          expect(Object.keys(row.values)).toEqual(fields);
      });
    });

    it("rejects library sorting with a Diagnostic Report that lists Sortable Fields", async () => {
      const error = await requestFailure(
        request({ sort: [{ field: "library", direction: "asc" }] }),
      );
      expect(error.code).toBe("unsortable-field");
      expect(error.diagnostic.expected).toEqual(dataset.sortableFields);
      expect(error.diagnostic.report.join("\n")).toContain(
        "Sortable Fields include",
      );
    });

    it("keeps library out of the default projection", async () => {
      using scenario = open();
      const found = await datasetResult(scenario, request());
      expect(found.query.fields).not.toContain("library");
      for (const row of found.rows)
        expect(row.values).not.toHaveProperty("library");
    });

    it("filters and projects library without more database reads", async () => {
      using scenario = open();
      const libraries = [personal, group];
      const baseline = await runEffect(
        collectQuery(dataset, { libraries, fields: [], sort: [] }),
        { client: scenario.db },
      );
      const selected = await runEffect(
        collectQuery(dataset, {
          libraries,
          fields: ["library"],
          sort: [],
          filter: 'library == "personal" || library == "group:4815"',
        }),
        { client: scenario.db },
      );
      expect(Exit.isSuccess(selected.exit)).toBe(true);
      const reads = (events: readonly RunEvent[]) =>
        events.flatMap((event) =>
          event.type === "statement" && event.statement.reader !== "layout"
            ? [event.statement.reader]
            : [],
        );
      expect(reads(selected.events)).toEqual(reads(baseline.events));
    });

    describe("failures", () => {
      it.each([...paths])(
        "fails the path %j with %s before it reads the database",
        async (path, code) => {
          const error = await requestFailure(
            request({ fields: [fields[0]!, path] }),
          );

          expect(error).toMatchObject({
            code,
            location: { argument: "fields", index: 1 },
          });
          // The report marks the whole entry the caller sent.
          if (path !== "") expect(error.diagnostic.excerpt?.at).toBe(path);
        },
      );

      it.each([...sortFields])(
        "fails the sort field %j with %s before it reads the database",
        async (field, code) => {
          const error = await requestFailure(
            request({ sort: [sort[0]!, { field, direction: "asc" }] }),
          );

          expect(error).toMatchObject({
            code,
            location: { argument: "sort", index: 1 },
          });
        },
      );

      it.each([0, -1, 1.5, Number.NaN])(
        "fails the limit %s before it reads the database",
        async (limit) => {
          const error = await requestFailure(request({ limit }));

          expect(error).toMatchObject({
            code: "invalid-limit",
            location: { argument: "limit" },
          });
        },
      );

      it("fails a request that names one Library twice", async () => {
        const error = await requestFailure({
          libraries: [personal, group, { ...personal }],
          limit: 1,
        });

        expect(error).toMatchObject({
          code: "duplicate-library",
          location: { argument: "libraries", index: 2 },
        });
      });
    });
  },
);

// Failure modes: an out-of-scope Indexed Key widens the read, loses its warning
// on an empty result, or hides a warning when another branch matches.
it.each([false, true])(
  "warns for an Indexed Key outside the Target Libraries (matching branch: %s)",
  async (matching) => {
    using scenario = openScenarioDatabase();
    const found = await result(scenario, {
      libraries: [personal],
      filter: `indexedKey == "ART2FULLg4815"${matching ? ' || indexedKey == "ART2FULL"' : ""}`,
      fields: [],
    });
    expect(keys(found)).toEqual(matching ? ["ART2FULL"] : []);
    expect(found.warnings).toMatchObject([
      {
        code: "key-outside-target-libraries",
        severity: "warning",
        found: "ART2FULLg4815",
        suggestions: ["library=personal,group:4815"],
      },
    ]);
    expect(found.warnings[0]?.message).toContain("group:4815");
  },
);

// Indexed Keys are Library-specific; bare Zotero keys are Library-local.
it.each([
  ['indexedKey == "ART2FULL"', ["ART2FULL"]],
  ['indexedKey == "ART2FULLg4815"', ["ART2FULLg4815"]],
  [
    '["ART2FULL", "ART2FULLg4815"].contains(indexedKey)',
    ["ART2FULL", "ART2FULLg4815"],
  ],
  ['key == "ART2FULL"', ["ART2FULL", "ART2FULLg4815"]],
  ['indexedKey == "bad"', []],
] as const)(
  "selects Items across two Libraries with %s",
  async (filter, expected) => {
    using scenario = openScenarioDatabase();
    const found = await result(scenario, {
      libraries: [personal, group],
      filter,
      fields: [],
      sort: [],
    });
    expect(keys(found)).toEqual(expected);
    expect(found.warnings).toEqual([]);
  },
);
it("warns that a bare Indexed Key names My Library under a group-only scope", async () => {
  using scenario = openScenarioDatabase();
  const found = await result(scenario, {
    libraries: [group],
    filter: 'indexedKey == "ART2FULL"',
    fields: [],
  });
  expect(found.rows).toEqual([]);
  expect(found.warnings).toMatchObject([
    {
      found: "ART2FULL",
      expected: ["personal"],
      suggestions: ["library=group:4815,personal"],
    },
  ]);
});
