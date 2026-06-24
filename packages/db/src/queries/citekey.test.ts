import { relations } from "@drizzle/relations";
import * as schema from "@drizzle/schema";
import { drizzle } from "drizzle-orm/node-sqlite";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type NodeDatabaseClient } from "@/client/node";
import { USER_LIBRARY_ID } from "@/lib/constants";

import { getItemIDByCitekey } from "./citekey";

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

describe("getItemIDByCitekey", () => {
  it("resolves the itemID of a live item by its citation key", () => {
    expect(getItemIDByCitekey(db, USER_LIBRARY_ID, "doe2024alpha")).toBe(1);
  });

  it("returns null when no item carries the citation key", () => {
    expect(getItemIDByCitekey(db, USER_LIBRARY_ID, "nobody2099")).toBeNull();
  });

  it("ignores deleted items", () => {
    expect(getItemIDByCitekey(db, USER_LIBRARY_ID, "gone2024")).toBeNull();
  });

  it("scopes the lookup to the requested library", () => {
    // The same key lives in both libraries; each library resolves its own item.
    expect(getItemIDByCitekey(db, USER_LIBRARY_ID, "shared2024")).toBe(6);
    expect(getItemIDByCitekey(db, 2, "shared2024")).toBe(7);
    // A group-only key is invisible from the user library.
    expect(getItemIDByCitekey(db, USER_LIBRARY_ID, "groupkey2025")).toBeNull();
    expect(getItemIDByCitekey(db, 2, "groupkey2025")).toBe(9);
  });

  it("does not match a non-citationKey field that holds the same value", () => {
    // `title` of item 8 equals the citekey we search; only the citationKey
    // field should match.
    expect(
      getItemIDByCitekey(db, USER_LIBRARY_ID, "title-collision"),
    ).toBeNull();
  });
});

function seedFixture(sqlite: DatabaseSync): void {
  sqlite.exec(`
    create table libraries (
      libraryID integer primary key,
      type text not null,
      editable integer not null,
      filesEditable integer not null,
      version integer not null default 0,
      storageVersion integer not null default 0,
      lastSync integer not null default 0,
      archived integer not null default 0,
      isAdmin integer not null default 0
    );
    create table groups (
      groupID integer primary key,
      libraryID integer not null,
      name text not null,
      description text not null,
      version integer not null
    );
    create table itemTypes (
      itemTypeID integer primary key,
      typeName text,
      templateItemTypeID integer,
      display integer
    );
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
    create table fieldsCombined (
      fieldID integer primary key,
      fieldName text not null,
      label text,
      fieldFormatID integer,
      custom integer not null
    );
    create table itemData (
      itemID integer,
      fieldID integer,
      valueID integer,
      primary key (itemID, fieldID)
    );
    create table itemDataValues (
      valueID integer primary key,
      value text
    );

    insert into libraries (libraryID, type, editable, filesEditable)
      values (1, 'user', 1, 1), (2, 'group', 1, 1);
    insert into groups (groupID, libraryID, name, description, version)
      values (17, 2, 'Shared lab', '', 1);

    insert into itemTypes (itemTypeID, typeName)
      values (1, 'journalArticle');

    insert into fieldsCombined (fieldID, fieldName, custom)
      values (10, 'title', 0), (11, 'citationKey', 0);

    insert into items (itemID, itemTypeID, dateAdded, dateModified, libraryID, key)
      values
        (1, 1, '2024-01-01 00:00:00', '2024-02-01 00:00:00', 1, 'USER1'),
        (2, 1, '2024-01-01 00:00:00', '2024-03-01 00:00:00', 1, 'DELETED'),
        (6, 1, '2024-01-01 00:00:00', '2024-07-01 00:00:00', 1, 'USER2'),
        (7, 1, '2024-01-01 00:00:00', '2025-01-01 00:00:00', 2, 'GRP1'),
        (8, 1, '2024-01-01 00:00:00', '2024-08-01 00:00:00', 1, 'USER3'),
        (9, 1, '2024-01-01 00:00:00', '2025-02-01 00:00:00', 2, 'GRP2');

    insert into deletedItems (itemID, dateDeleted)
      values (2, '2024-03-02 00:00:00');

    insert into itemDataValues (valueID, value)
      values
        (100, 'doe2024alpha'),
        (101, 'gone2024'),
        (102, 'shared2024'),
        (103, 'shared2024'),
        (104, 'groupkey2025'),
        (105, 'title-collision');

    insert into itemData (itemID, fieldID, valueID)
      values
        (1, 11, 100),
        (2, 11, 101),
        (6, 11, 102),
        (7, 11, 103),
        (9, 11, 104),
        (8, 10, 105);
  `);
}
