import { relations } from "@drizzle/relations";
import * as schema from "@drizzle/schema";
import { drizzle } from "drizzle-orm/node-sqlite";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type NodeDatabaseClient } from "@/client/node";

import { getRelatedKeysByItemID } from "./item-relations";

let sqlite: DatabaseSync;
let db: NodeDatabaseClient;

beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  seedFixture(sqlite);
  db = drizzle({ client: sqlite, schema, relations });
});

afterEach(() => {
  sqlite.close();
});

describe("getRelatedKeysByItemID", () => {
  it("returns dc:relation object keys for the item", () => {
    expect(getRelatedKeysByItemID(db, 1).toSorted()).toEqual([
      "RELATEDA",
      "RELATEDB",
    ]);
  });

  it("ignores non-dc:relation predicates (owl:sameAs, dc:replaces)", () => {
    // item 2 only has an owl:sameAs row → no related items.
    expect(getRelatedKeysByItemID(db, 2)).toEqual([]);
  });

  it("is forward-only: returns only rows owned by the queried itemID", () => {
    // Item 5 owns a row pointing at ITEM3REL; item 3 does NOT own that row, so
    // querying item 3 must not surface it (no inverse-relation traversal).
    expect(getRelatedKeysByItemID(db, 3)).toEqual(["RELATEDC"]);
    expect(getRelatedKeysByItemID(db, 5)).toEqual(["ITEM3REL"]);
  });

  it("skips object URIs that are not Zotero item URIs", () => {
    // item 4 relates to a collection URI → unparseable as an item, omitted.
    expect(getRelatedKeysByItemID(db, 4)).toEqual([]);
  });

  it("returns an empty array when the item has no relations", () => {
    expect(getRelatedKeysByItemID(db, 99)).toEqual([]);
  });
});

function seedFixture(sqlite: DatabaseSync): void {
  sqlite.exec(`
    create table relationPredicates (
      predicateID integer primary key,
      predicate text
    );
    create table itemRelations (
      itemID integer not null,
      predicateID integer not null,
      object text not null,
      primary key (itemID, predicateID, object)
    );

    insert into relationPredicates (predicateID, predicate)
      values (1, 'dc:relation'), (2, 'owl:sameAs'), (3, 'dc:replaces');

    insert into itemRelations (itemID, predicateID, object)
      values
        (1, 1, 'http://zotero.org/users/12345/items/RELATEDA'),
        (1, 1, 'http://zotero.org/groups/9/items/RELATEDB'),
        (1, 2, 'http://zotero.org/users/12345/items/SAMEASXX'),
        (2, 2, 'http://zotero.org/users/12345/items/SAMEASYY'),
        (3, 1, 'http://zotero.org/users/12345/items/RELATEDC'),
        (4, 1, 'http://zotero.org/users/12345/collections/COLLECTN'),
        (5, 1, 'http://zotero.org/users/12345/items/ITEM3REL');
  `);
}
