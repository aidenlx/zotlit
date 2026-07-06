import { relations } from "@drizzle/relations";
import * as schema from "@drizzle/schema";
import { drizzle } from "drizzle-orm/node-sqlite";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type NodeDatabaseClient } from "@/client/node";
import { CollectionCache } from "@/lib/zt-collection";

import {
  collectionIDsByItemQuery,
  collectionNodesByLibraryQuery,
} from "./collections";

let sqlite: DatabaseSync;
let db: NodeDatabaseClient;

beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  seed(sqlite);
  db = drizzle({ client: sqlite, schema, relations });
});

afterEach(() => {
  sqlite.close();
});

describe("collectionIDsByItemQuery", () => {
  it("excludes memberships in trashed collections", () => {
    const ids = collectionIDsByItemQuery
      .prepared(db)
      .all({ itemID: 1 })
      .map((row) => row.collectionID)
      .toSorted((a, b) => a - b);

    // item 1 is in 100, 101, 103, and the trashed 105 — 105 is dropped.
    expect(ids).toEqual([100, 101, 103]);
  });

  it("excludes memberships when the item itself is trashed", () => {
    expect(collectionIDsByItemQuery.prepared(db).all({ itemID: 3 })).toEqual(
      [],
    );
  });
});

describe("collectionNodesByLibraryQuery", () => {
  it("returns only non-trashed nodes in the library", () => {
    const ids = collectionNodesByLibraryQuery
      .prepared(db)
      .all({ libraryID: 1 })
      .map((row) => row.collectionID)
      .toSorted((a, b) => a - b);

    // 102 and 105 are trashed; 200 belongs to library 2.
    expect(ids).toEqual([100, 101, 103, 104]);
  });
});

describe("CollectionCache.byItemIDs", () => {
  it("resolves root→leaf paths, sorted by name within each item", () => {
    const cache = new CollectionCache();
    const result = cache.byItemIDs(db, 1, [1, 2, 3]);

    expect(result.get(1)?.map((c) => [c.name, c.path])).toEqual([
      ["Deep", ["Deep"]],
      ["Reading", ["Research", "Reading"]],
      ["Research", ["Research"]],
    ]);
    expect(result.get(2)?.map((c) => [c.name, c.path])).toEqual([
      ["Standalone", ["Standalone"]],
    ]);
    expect(result.get(3)).toEqual([]);
  });

  it("truncates a live collection's path at a trashed ancestor", () => {
    // 103 "Deep" sits under the trashed 102 "Archive" (under live 100). The
    // path roots at the first live ancestor in the node set — just ["Deep"].
    const deep = new CollectionCache().byItemIDs(db, 1, [1]).get(1)?.[0];

    expect(deep).toMatchObject({ name: "Deep", path: ["Deep"] });
  });

  it("reuses one node load across items (library cached on the instance)", () => {
    const cache = new CollectionCache();
    cache.byItemIDs(db, 1, [1]);
    // A second call for the same library must still resolve correctly off the
    // cached node map.
    expect(
      cache
        .byItemIDs(db, 1, [2])
        .get(2)
        ?.map((c) => c.name),
    ).toEqual(["Standalone"]);
  });

  it("memoizes per itemID: a repeat call skips the membership query", () => {
    const cache = new CollectionCache();
    expect(
      cache
        .byItemIDs(db, 1, [1])
        .get(1)
        ?.map((c) => c.name),
    ).toEqual(["Deep", "Reading", "Research"]);

    // Mutating the underlying membership row must not affect a repeat call
    // for the same itemID — proof the second call reused the first's result
    // instead of re-querying.
    sqlite.exec("delete from collectionItems where itemID = 1");

    expect(
      cache
        .byItemIDs(db, 1, [1])
        .get(1)
        ?.map((c) => c.name),
    ).toEqual(["Deep", "Reading", "Research"]);
  });
});

function seed(sqlite: DatabaseSync): void {
  sqlite.exec(`
    create table items (
      itemID integer primary key,
      itemTypeID integer not null,
      dateAdded text not null,
      dateModified text not null,
      libraryID integer not null,
      key text not null
    );
    create table deletedItems (
      itemID integer primary key,
      dateDeleted text not null
    );
    create table collections (
      collectionID integer primary key,
      collectionName text not null,
      parentCollectionID integer,
      libraryID integer not null,
      key text not null
    );
    create table deletedCollections (
      collectionID integer primary key,
      dateDeleted text not null
    );
    create table collectionItems (
      collectionID integer not null,
      itemID integer not null,
      orderIndex integer not null default 0,
      primary key (collectionID, itemID)
    );

    insert into items (itemID, itemTypeID, dateAdded, dateModified, libraryID, key)
      values
        (1, 1, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 1, 'ITEM1'),
        (2, 1, '2024-01-02 00:00:00', '2024-01-02 00:00:00', 1, 'ITEM2'),
        (3, 1, '2024-01-03 00:00:00', '2024-01-03 00:00:00', 1, 'TRASH');

    insert into deletedItems (itemID, dateDeleted) values (3, '2024-01-03 00:00:01');

    insert into collections (collectionID, collectionName, parentCollectionID, libraryID, key)
      values
        (100, 'Research', null, 1, 'COLL0100'),
        (101, 'Reading', 100, 1, 'COLL0101'),
        (102, 'Archive', 100, 1, 'COLL0102'),
        (103, 'Deep', 102, 1, 'COLL0103'),
        (104, 'Standalone', null, 1, 'COLL0104'),
        (105, 'Trashed top', null, 1, 'COLL0105'),
        (200, 'Other library', null, 2, 'COLL0200');

    -- 102 "Archive" is trashed but its live child 103 "Deep" was restored /
    -- reparented, so 103 stays out of deletedCollections (live under trashed).
    insert into deletedCollections (collectionID, dateDeleted)
      values
        (102, '2024-02-01 00:00:00'),
        (105, '2024-02-01 00:00:00');

    insert into collectionItems (collectionID, itemID)
      values
        (100, 1),
        (101, 1),
        (103, 1),
        (105, 1),
        (102, 2),
        (104, 2),
        (100, 3);
  `);
}
