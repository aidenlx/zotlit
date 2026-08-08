import { relations } from "@drizzle/relations";
import { drizzle } from "drizzle-orm/node-sqlite";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { NodeDatabaseClient } from "@/client/node";
import { createFixtureSchema } from "@/test-utils";

import {
  getCollectionIDByKey,
  getIndexedItemIDsByCollection,
  getNoteItemIDsByCollection,
  getNoteItemIDsByLibrary,
} from "./batch-scope";

const ROOT = "COLL0100";

let sqlite: DatabaseSync;
let db: NodeDatabaseClient;

beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  seed(sqlite);
  db = drizzle({ client: sqlite, relations });
});

afterEach(() => {
  sqlite.close();
});

describe("getCollectionIDByKey", () => {
  it("resolves a key within its library", () => {
    expect(
      getCollectionIDByKey(db, { libraryID: 1, collectionKey: ROOT }),
    ).toBe(100);
  });

  it("scopes the lookup to the library, not the key alone", () => {
    // Library 2 owns its own collection under the same key.
    expect(
      getCollectionIDByKey(db, { libraryID: 2, collectionKey: ROOT }),
    ).toBe(200);
  });

  it("returns undefined for an unknown key", () => {
    expect(
      getCollectionIDByKey(db, { libraryID: 1, collectionKey: "NOSUCH12" }),
    ).toBeUndefined();
  });

  it("returns undefined for a trashed collection", () => {
    expect(
      getCollectionIDByKey(db, { libraryID: 1, collectionKey: "COLL0103" }),
    ).toBeUndefined();
  });
});

describe("getIndexedItemIDsByCollection", () => {
  it("gathers regular items across the collection and its descendants", () => {
    // 1 in the root, 2 one level down, 3 two levels down.
    expect(sorted(byCollection(ROOT))).toEqual([1, 2, 3]);
  });

  it("excludes trashed items, notes, and attachments", () => {
    const ids = byCollection(ROOT);

    expect(ids).not.toContain(5); // trashed regular item
    expect(ids).not.toContain(6); // standalone note
    expect(ids).not.toContain(12); // attachment
  });

  it("excludes items in unrelated and trashed collections", () => {
    const ids = byCollection(ROOT);

    expect(ids).not.toContain(4); // sibling collection outside the subtree
    expect(ids).not.toContain(10); // trashed subcollection
  });

  it("returns an empty list for an unknown key", () => {
    expect(byCollection("NOSUCH12")).toEqual([]);
  });

  it("scopes to the library of the requested collection", () => {
    expect(
      getIndexedItemIDsByCollection(db, { libraryID: 2, collectionKey: ROOT }),
    ).toEqual([20]);
  });
});

describe("getNoteItemIDsByCollection", () => {
  it("gathers standalone notes and child notes of items in scope", () => {
    // 6 is standalone in a subcollection; 7 hangs off item 2 in that same one.
    expect(sorted(notesByCollection(ROOT))).toEqual([6, 7]);
  });

  it("excludes a note whose parent item is trashed", () => {
    expect(notesByCollection(ROOT)).not.toContain(8);
  });

  it("excludes a trashed note", () => {
    expect(notesByCollection(ROOT)).not.toContain(9);
  });

  it("excludes notes outside the subtree", () => {
    const ids = notesByCollection(ROOT);

    expect(ids).not.toContain(13); // child of an item in a sibling collection
    expect(ids).not.toContain(14); // standalone note filed nowhere
  });

  it("returns an empty list for an unknown key", () => {
    expect(notesByCollection("NOSUCH12")).toEqual([]);
  });
});

describe("getNoteItemIDsByLibrary", () => {
  it("gathers every live note in the library, filed or not", () => {
    expect(sorted(getNoteItemIDsByLibrary(db, 1))).toEqual([6, 7, 13, 14]);
  });

  it("excludes notes of another library", () => {
    expect(getNoteItemIDsByLibrary(db, 2)).toEqual([21]);
  });
});

function byCollection(collectionKey: string): number[] {
  return getIndexedItemIDsByCollection(db, { libraryID: 1, collectionKey });
}

function notesByCollection(collectionKey: string): number[] {
  return getNoteItemIDsByCollection(db, { libraryID: 1, collectionKey });
}

function sorted(ids: readonly number[]): number[] {
  return [...ids].toSorted((a, b) => a - b);
}

function seed(sqlite: DatabaseSync): void {
  createFixtureSchema(sqlite);
  sqlite.exec(`
    insert into itemTypes (itemTypeID, typeName)
      values (1, 'journalArticle'), (2, 'note'), (3, 'attachment');

    insert into items (itemID, itemTypeID, dateAdded, dateModified, libraryID, key)
      values
        (1,  1, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 1, 'ITEM0001'),
        (2,  1, '2024-01-02 00:00:00', '2024-01-02 00:00:00', 1, 'ITEM0002'),
        (3,  1, '2024-01-03 00:00:00', '2024-01-03 00:00:00', 1, 'ITEM0003'),
        (4,  1, '2024-01-04 00:00:00', '2024-01-04 00:00:00', 1, 'ITEM0004'),
        (5,  1, '2024-01-05 00:00:00', '2024-01-05 00:00:00', 1, 'ITEM0005'),
        (6,  2, '2024-01-06 00:00:00', '2024-01-06 00:00:00', 1, 'NOTE0006'),
        (7,  2, '2024-01-07 00:00:00', '2024-01-07 00:00:00', 1, 'NOTE0007'),
        (8,  2, '2024-01-08 00:00:00', '2024-01-08 00:00:00', 1, 'NOTE0008'),
        (9,  2, '2024-01-09 00:00:00', '2024-01-09 00:00:00', 1, 'NOTE0009'),
        (10, 1, '2024-01-10 00:00:00', '2024-01-10 00:00:00', 1, 'ITEM0010'),
        (12, 3, '2024-01-12 00:00:00', '2024-01-12 00:00:00', 1, 'ATTA0012'),
        (13, 2, '2024-01-13 00:00:00', '2024-01-13 00:00:00', 1, 'NOTE0013'),
        (14, 2, '2024-01-14 00:00:00', '2024-01-14 00:00:00', 1, 'NOTE0014'),
        (20, 1, '2024-01-20 00:00:00', '2024-01-20 00:00:00', 2, 'ITEM0020'),
        (21, 2, '2024-01-21 00:00:00', '2024-01-21 00:00:00', 2, 'NOTE0021');

    -- 5 is a trashed regular item; 9 is a trashed child note.
    insert into deletedItems (itemID, dateDeleted)
      values (5, '2024-02-01 00:00:00'), (9, '2024-02-01 00:00:00');

    insert into itemNotes (itemID, parentItemID, title)
      values
        (6,  null, 'Standalone in subcollection'),
        (7,  2,    'Child of an item in scope'),
        (8,  5,    'Child of a trashed item'),
        (9,  2,    'Trashed child note'),
        (13, 4,    'Child of an item out of scope'),
        (14, null, 'Standalone, filed nowhere'),
        (21, null, 'Standalone in the other library');

    insert into collections (collectionID, collectionName, parentCollectionID, libraryID, key)
      values
        (100, 'Root', null, 1, 'COLL0100'),
        (101, 'Child', 100, 1, 'COLL0101'),
        (102, 'Grandchild', 101, 1, 'COLL0102'),
        (103, 'Trashed child', 100, 1, 'COLL0103'),
        (104, 'Sibling', null, 1, 'COLL0104'),
        (200, 'Other library root', null, 2, 'COLL0100');

    insert into deletedCollections (collectionID, dateDeleted)
      values (103, '2024-02-01 00:00:00');

    insert into collectionItems (collectionID, itemID)
      values
        (100, 1),
        (101, 2),
        (102, 3),
        (104, 4),
        (100, 5),
        (101, 6),
        (103, 10),
        (100, 12),
        (200, 20),
        (200, 21);
  `);
}
