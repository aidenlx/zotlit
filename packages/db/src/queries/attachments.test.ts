import { relations } from "@drizzle/relations";
import * as schema from "@drizzle/schema";
import { drizzle } from "drizzle-orm/node-sqlite";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type NodeDatabaseClient } from "@/client/node";

import { getAttachmentByKey, getAttachmentsByParents } from "./attachments";

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

describe("getAttachmentsByParents", () => {
  it("returns visible attachments tagged with their parentItemID for caller grouping", () => {
    const result = getAttachmentsByParents(db, [100, 200], 1);

    expect(result.map((a) => [a.parentItemID, a.key])).toEqual([
      [100, "ATTA1"],
      [100, "ATTA2"],
      [200, "ATTB1"],
    ]);
  });

  it("excludes deleted attachments via item.deletedItem filter", () => {
    const keys = new Set(
      getAttachmentsByParents(db, [100], 1).map((a) => a.key),
    );

    expect(keys.has("TRASHED")).toBe(false);
  });

  it("excludes attachments from other libraries", () => {
    const keys = new Set(
      getAttachmentsByParents(db, [100], 1).map((a) => a.key),
    );

    expect(keys.has("ATTOTHER")).toBe(false);
  });

  it("returns an empty array when no parent has attachments", () => {
    expect(getAttachmentsByParents(db, [999], 1)).toEqual([]);
  });

  it("returns an empty array for empty parent input", () => {
    expect(getAttachmentsByParents(db, [], 1)).toEqual([]);
  });

  it("surfaces path, contentType, and raw linkMode", () => {
    const [first] = getAttachmentsByParents(db, [100], 1);

    expect(first).toMatchObject({
      key: "ATTA1",
      parentItemID: 100,
      path: "storage:paper.pdf",
      contentType: "application/pdf",
      linkMode: 0,
    });
    expect(typeof first?.dateAdded.epochMilliseconds).toBe("number");
    expect(typeof first?.dateModified.epochMilliseconds).toBe("number");
  });

  it("reuses the prepared statement across different parent IDs", () => {
    const r1 = getAttachmentsByParents(db, [100], 1).map((a) => a.key);
    const r2 = getAttachmentsByParents(db, [200], 1).map((a) => a.key);

    expect(r1).toEqual(["ATTA1", "ATTA2"]);
    expect(r2).toEqual(["ATTB1"]);
    expect(getAttachmentsByParents(db, [100], 1).map((a) => a.key)).toEqual([
      "ATTA1",
      "ATTA2",
    ]);
  });
});

describe("getAttachmentByKey", () => {
  it("returns a visible attachment by library and key", () => {
    expect(getAttachmentByKey(db, "ATTA1", 1)).toMatchObject({
      key: "ATTA1",
      parentItemID: 100,
      path: "storage:paper.pdf",
    });
  });

  it("returns null for missing, deleted, or other-library attachments", () => {
    expect(getAttachmentByKey(db, "MISSING", 1)).toBeNull();
    expect(getAttachmentByKey(db, "TRASHED", 1)).toBeNull();
    expect(getAttachmentByKey(db, "ATTOTHER", 1)).toBeNull();
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
    create table itemAttachments (
      itemID integer primary key,
      parentItemID integer,
      linkMode integer,
      contentType text,
      path text
    );
    create table deletedItems (
      itemID integer primary key,
      dateDeleted text not null
    );

    insert into items (itemID, itemTypeID, dateAdded, dateModified, libraryID, key)
      values
        (100, 1, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 1, 'PARA'),
        (200, 1, '2024-01-02 00:00:00', '2024-01-02 00:00:00', 1, 'PARB'),
        (101, 2, '2024-01-03 00:00:00', '2024-01-03 00:00:00', 1, 'ATTA1'),
        (102, 2, '2024-01-04 00:00:00', '2024-01-04 00:00:00', 1, 'ATTA2'),
        (103, 2, '2024-01-05 00:00:00', '2024-01-05 00:00:00', 1, 'TRASHED'),
        (201, 2, '2024-01-06 00:00:00', '2024-01-06 00:00:00', 1, 'ATTB1'),
        (301, 2, '2024-01-07 00:00:00', '2024-01-07 00:00:00', 2, 'ATTOTHER');

    insert into itemAttachments (itemID, parentItemID, linkMode, contentType, path)
      values
        (101, 100, 0, 'application/pdf', 'storage:paper.pdf'),
        (102, 100, 2, 'application/epub+zip', '/abs/path/book.epub'),
        (103, 100, 0, 'application/pdf', 'storage:trashed.pdf'),
        (201, 200, 1, 'text/html', null),
        (301, 100, 0, 'application/pdf', 'storage:other-lib.pdf');

    insert into deletedItems (itemID, dateDeleted)
      values (103, '2024-01-05 00:00:01');
  `);
}
