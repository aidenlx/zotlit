import { relations } from "@drizzle/relations";
import { drizzle } from "drizzle-orm/node-sqlite";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { NodeDatabaseClient } from "@/client/node";
import { USER_LIBRARY_ID } from "@/lib/constants";
import { createFixtureSchema } from "@/test-utils";

import {
  getCitekeyByItemKey,
  getCitekeysByLibrary,
  getItemIDByCitekey,
} from "./citekey";

let sqlite: DatabaseSync;
let db: NodeDatabaseClient;

beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  seedFixture(sqlite);
  db = drizzle({ client: sqlite, relations });
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

describe("getCitekeyByItemKey", () => {
  it("resolves the citation key of a live item by its Zotero key", () => {
    expect(getCitekeyByItemKey(db, USER_LIBRARY_ID, "USER1")).toBe(
      "doe2024alpha",
    );
  });

  it("returns null when the item carries no citation key", () => {
    // Item 8 (USER3) has only a `title` field, no citationKey.
    expect(getCitekeyByItemKey(db, USER_LIBRARY_ID, "USER3")).toBeNull();
  });

  it("returns null when no item has the key", () => {
    expect(getCitekeyByItemKey(db, USER_LIBRARY_ID, "NOPE")).toBeNull();
  });

  it("ignores deleted items", () => {
    expect(getCitekeyByItemKey(db, USER_LIBRARY_ID, "DELETED")).toBeNull();
  });

  it("scopes the lookup to the requested library", () => {
    expect(getCitekeyByItemKey(db, 2, "GRP1")).toBe("shared2024");
    // The same key does not exist in the user library.
    expect(getCitekeyByItemKey(db, USER_LIBRARY_ID, "GRP1")).toBeNull();
  });
});

describe("getCitekeysByLibrary", () => {
  it("returns every live keyed item of the user library", () => {
    const rows = getCitekeysByLibrary(db, USER_LIBRARY_ID);
    expect(rows).toEqual(
      expect.arrayContaining([
        {
          itemID: 1,
          key: "USER1",
          indexedKey: "USER1",
          citekey: "doe2024alpha",
        },
        { itemID: 6, key: "USER2", indexedKey: "USER2", citekey: "shared2024" },
      ]),
    );
    expect(rows).toHaveLength(2);
  });

  it("scopes rows to the requested library and marks group rows with the indexed key", () => {
    const rows = getCitekeysByLibrary(db, 2);
    expect(rows).toEqual(
      expect.arrayContaining([
        {
          itemID: 7,
          key: "GRP1",
          indexedKey: "GRP1g17",
          citekey: "shared2024",
        },
        {
          itemID: 9,
          key: "GRP2",
          indexedKey: "GRP2g17",
          citekey: "groupkey2025",
        },
      ]),
    );
    expect(rows).toHaveLength(2);
  });

  it("excludes deleted items", () => {
    const rows = getCitekeysByLibrary(db, USER_LIBRARY_ID);
    expect(rows.some((row) => row.itemID === 2)).toBe(false);
  });

  it("excludes a non-citationKey field holding the same value", () => {
    // Item 8 (USER3) has only a `title` field, not a citationKey.
    const rows = getCitekeysByLibrary(db, USER_LIBRARY_ID);
    expect(rows.some((row) => row.itemID === 8)).toBe(false);
  });
});

function seedFixture(sqlite: DatabaseSync): void {
  createFixtureSchema(sqlite);
  sqlite.exec(`
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
