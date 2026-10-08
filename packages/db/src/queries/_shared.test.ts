import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createClient } from "@/client/node";
import type { NodeDatabaseClient } from "@/client/node";
import {
  countCompiles,
  countStatements,
  createFixtureSchema,
} from "@/test-utils";

import { defineKeyedQuery } from "./_shared";

const itemRows = defineKeyedQuery<string, { libraryID: number }>()(
  (db, { contains, placeholder }) =>
    db.query.items.findMany({
      columns: { itemID: true, key: true },
      where: {
        libraryID: placeholder("libraryID"),
        RAW: (item) => contains(item.key),
      },
    }),
  { keyOf: (row) => row.key },
);

const tagRows = defineKeyedQuery<number>()(
  (db, { contains }, args: { descending: boolean }) =>
    db.query.itemTags.findMany({
      where: { RAW: (tag) => contains(tag.itemID) },
      orderBy: { tagID: args.descending ? "desc" : "asc" },
    }),
  { keyOf: (row) => row.itemID },
);

let db: NodeDatabaseClient;
beforeEach(() => {
  db = createClient(":memory:");
  createFixtureSchema(db.$client);
  db.$client.exec(`
    insert into items (itemID,itemTypeID,libraryID,key,dateAdded,dateModified) values
      (1,1,1,'FIRST','2024-01-01 00:00:00','2024-01-01 00:00:00'),
      (2,1,1,'SECOND','2024-01-01 00:00:00','2024-01-01 00:00:00'),
      (3,1,2,'FIRST','2024-01-01 00:00:00','2024-01-01 00:00:00');
    insert into itemTags (itemID,tagID,type) values (1,10,0),(1,20,0),(2,30,0);
  `);
});
afterEach(() => db.$client.close());

describe("defineKeyedQuery", () => {
  it("omits misses and repeats rows in request order, within the requested Library", () => {
    expect(
      itemRows(db, ["SECOND", "FIRST", "absent", "SECOND"], {
        params: { libraryID: 1 },
      }),
    ).toEqual([
      { itemID: 2, key: "SECOND" },
      { itemID: 1, key: "FIRST" },
      { itemID: 2, key: "SECOND" },
    ]);
    expect(itemRows(db, ["FIRST"], { params: { libraryID: 2 } })).toEqual([
      { itemID: 3, key: "FIRST" },
    ]);
  });

  it("keeps one cached statement as the requested list grows past SQLite's variable limit", () => {
    const statements = countStatements(db.$client);
    const compiles = countCompiles(db.$client);
    itemRows(db, ["FIRST"], { params: { libraryID: 1 } });
    const compiled = compiles();
    const before = statements();
    const misses = Array.from({ length: 40_000 }, (_, i) => `missing-${i}`);
    expect(
      itemRows(db, ["SECOND", ...misses, "FIRST", "SECOND"], {
        params: { libraryID: 1 },
      }),
    ).toEqual([
      { itemID: 2, key: "SECOND" },
      { itemID: 1, key: "FIRST" },
      { itemID: 2, key: "SECOND" },
    ]);
    expect(statements() - before).toBe(1);
    expect(compiles()).toBe(compiled);
  });

  it("executes no statement for an empty list", () => {
    const statements = countStatements(db.$client);
    const compiles = countCompiles(db.$client);
    expect(itemRows(db, [], { params: { libraryID: 1 } })).toEqual([]);
    expect(statements()).toBe(0);
    expect(compiles()).toBe(0);
  });

  it("preserves query order within each key and caches each query shape separately", () => {
    const compiles = countCompiles(db.$client);
    expect(
      tagRows(db, [2, 1, 99, 1], { args: { descending: false } }).map(
        (row) => row.tagID,
      ),
    ).toEqual([30, 10, 20, 10, 20]);
    expect(
      tagRows(db, [1], { args: { descending: true } }).map((row) => row.tagID),
    ).toEqual([20, 10]);
    const compiled = compiles();
    expect(
      tagRows(db, [1], { args: { descending: false } }).map((row) => row.tagID),
    ).toEqual([10, 20]);
    expect(compiles()).toBe(compiled);
  });

  it("treats key text as data", () => {
    expect(
      itemRows(db, ["FIRST') OR 1=1 --", '"FIRST"', "SECOND"], {
        params: { libraryID: 1 },
      }),
    ).toEqual([{ itemID: 2, key: "SECOND" }]);
  });
});
