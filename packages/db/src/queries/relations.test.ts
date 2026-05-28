import { relations } from "@drizzle/relations";
import * as schema from "@drizzle/schema";
import { drizzle } from "drizzle-orm/node-sqlite";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type NodeDatabaseClient } from "@/client/node";

import { CHILD_ITEM_TYPES } from "./_shared";

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

describe("relations.ts", () => {
  it("traverses itemAnnotations → item + parentAttachment", () => {
    const rows = db.query.itemAnnotations
      .findMany({
        with: {
          item: { columns: { key: true, libraryID: true } },
          parentAttachment: { columns: { itemID: true, contentType: true } },
        },
        orderBy: { sortIndex: "asc" },
      })
      .sync();

    expect(rows).toHaveLength(2);
    expect(rows[0]?.item).toEqual({ key: "ANNOT001", libraryID: 1 });
    expect(rows[0]?.parentAttachment).toEqual({
      itemID: 200,
      contentType: "application/pdf",
    });
  });

  it("excludes trashed annotations via { item: { deletedItem: false } }", () => {
    const rows = db.query.itemAnnotations
      .findMany({
        where: { item: { deletedItem: false } },
        columns: { itemID: true },
      })
      .sync();

    expect(rows.map((r) => r.itemID)).toEqual([300]);
  });

  it("filters items by itemType.typeName via implicit FK relation", () => {
    const rows = db.query.items
      .findMany({
        where: { itemType: { typeName: { notIn: [...CHILD_ITEM_TYPES] } } },
        columns: { key: true },
      })
      .sync();

    expect(rows.map((r) => r.key)).toEqual(["PARENT01"]);
  });

  it("returns deletedItem as a single object (not array) — cardinality fix", () => {
    const row = db.query.items
      .findFirst({
        where: { itemID: { eq: 301 } },
        with: { deletedItem: true },
        columns: { itemID: true },
      })
      .sync();

    expect(row?.deletedItem).toMatchObject({ itemID: 301 });

    const live = db.query.items
      .findFirst({
        where: { itemID: { eq: 300 } },
        with: { deletedItem: true },
        columns: { itemID: true },
      })
      .sync();

    expect(live?.deletedItem).toBeNull();
  });
});

function seed(sqlite: DatabaseSync): void {
  sqlite.exec(`
    create table itemTypes (
      itemTypeID integer primary key,
      typeName text
    );
    create table libraries (
      libraryID integer primary key,
      type text not null
    );
    create table items (
      itemID integer primary key,
      itemTypeID integer not null,
      dateAdded text not null,
      dateModified text not null,
      libraryID integer not null,
      key text not null
    );
    create table itemAttachments (
      itemID integer primary key,
      parentItemID integer,
      contentType text
    );
    create table itemAnnotations (
      itemID integer primary key,
      parentItemID integer not null,
      type integer not null,
      authorName text,
      text text,
      comment text,
      color text,
      pageLabel text,
      sortIndex text not null,
      position text not null,
      isExternal integer not null
    );
    create table deletedItems (
      itemID integer primary key,
      dateDeleted text not null
    );

    insert into itemTypes (itemTypeID, typeName) values
      (1, 'journalArticle'),
      (2, 'attachment'),
      (3, 'annotation');

    insert into libraries (libraryID, type) values (1, 'user');

    insert into items (itemID, itemTypeID, dateAdded, dateModified, libraryID, key) values
      (100, 1, '2026-05-28 00:00:00', '2026-05-28 00:00:00', 1, 'PARENT01'),
      (200, 2, '2026-05-28 00:00:01', '2026-05-28 00:00:01', 1, 'ATTACH01'),
      (300, 3, '2026-05-28 00:00:02', '2026-05-28 00:00:02', 1, 'ANNOT001'),
      (301, 3, '2026-05-28 00:00:03', '2026-05-28 00:00:03', 1, 'ANNOT002');

    insert into itemAttachments (itemID, parentItemID, contentType) values
      (200, 100, 'application/pdf');

    insert into itemAnnotations (itemID, parentItemID, type, sortIndex, position, isExternal) values
      (300, 200, 1, '00000|000100|00010', '{}', 0),
      (301, 200, 1, '00000|000200|00010', '{}', 0);

    insert into deletedItems (itemID, dateDeleted) values (301, '2026-05-28 00:00:04');
  `);
}
