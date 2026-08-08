import { relations } from "@drizzle/relations";
import { drizzle } from "drizzle-orm/node-sqlite";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { NodeDatabaseClient } from "@/client/node";
import { USER_LIBRARY_ID } from "@/lib/constants";
import { createFixtureSchema } from "@/test-utils";

import { getIndexedItemsByLibrary, getIndexSignature } from "./index-items";

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

describe("getIndexedItemsByLibrary", () => {
  it("resolves baseFieldMappingsCombined aliases to canonical columns", () => {
    const byID = new Map(
      getIndexedItemsByLibrary(db, USER_LIBRARY_ID).map((item) => [
        item.itemID,
        item,
      ]),
    );

    expect(byID.get(1)?.publicationTitle).toBe("Journal of Kernels");
    expect(byID.get(2)?.publicationTitle).toBe("Collected Essays");
  });

  it("orders indexed items by dateModified descending", () => {
    const result = getIndexedItemsByLibrary(db, USER_LIBRARY_ID);

    expect(result.map((item) => item.key)).toEqual([
      "NEWEST",
      "BOOKSEC",
      "ARTICLE",
    ]);
    for (let index = 1; index < result.length; index++) {
      expect(
        result[index - 1]!.dateModified.epochMilliseconds,
      ).toBeGreaterThanOrEqual(result[index]!.dateModified.epochMilliseconds);
    }
  });

  it("excludes child item types and tombstoned items", () => {
    const result = getIndexedItemsByLibrary(db, USER_LIBRARY_ID);

    expect(result.map((item) => item.key)).not.toContain("DELETED");
    expect(
      result.some((item) =>
        ["attachment", "note", "annotation"].includes(item.itemType),
      ),
    ).toBe(false);
  });
});

describe("getIndexSignature", () => {
  it("counts only indexed items and checksums the row set", () => {
    const signature = getIndexSignature(db, USER_LIBRARY_ID);

    // ARTICLE (id1) + BOOKSEC (id2) + NEWEST (id7) — excludes DELETED + child types.
    expect(signature.count).toBe(3);
    expect(signature.checksum).toBe(5159635210);
  });

  it("moves the checksum when a non-max item is edited into the max second", () => {
    const before = getIndexSignature(db, USER_LIBRARY_ID);
    // ARTICLE jumps to NEWEST's second: count and max(dateModified) both stay put,
    // but the per-row checksum must still move so the gate rebuilds.
    sqlite.exec(
      "update items set dateModified = '2025-01-01 00:00:00' where itemID = 1",
    );
    const after = getIndexSignature(db, USER_LIBRARY_ID);

    expect(after.count).toBe(before.count);
    expect(after.checksum).not.toBe(before.checksum);
    expect(after.checksum).toBe(5188579210);
  });
});

function seedFixture(sqlite: DatabaseSync): void {
  createFixtureSchema(sqlite);
  sqlite.exec(`
    insert into libraries (libraryID, type, editable, filesEditable)
      values (1, 'user', 1, 1);

    insert into itemTypes (itemTypeID, typeName)
      values
        (1, 'journalArticle'),
        (2, 'attachment'),
        (3, 'note'),
        (4, 'annotation'),
        (5, 'bookSection');

    insert into fieldsCombined (fieldID, fieldName, custom)
      values
        (10, 'title', 0),
        (11, 'citationKey', 0),
        (12, 'date', 0),
        (13, 'publicationTitle', 0),
        (20, 'bookTitle', 0);

    insert into baseFieldMappingsCombined (itemTypeID, baseFieldID, fieldID)
      values (5, 13, 20);

    insert into items (itemID, itemTypeID, dateAdded, dateModified, libraryID, key)
      values
        (1, 1, '2024-01-01 00:00:00', '2024-02-01 00:00:00', 1, 'ARTICLE'),
        (2, 5, '2024-01-01 00:00:00', '2024-06-01 00:00:00', 1, 'BOOKSEC'),
        (3, 1, '2024-01-01 00:00:00', '2024-03-01 00:00:00', 1, 'DELETED'),
        (4, 2, '2024-01-01 00:00:00', '2024-04-01 00:00:00', 1, 'ATTACH'),
        (5, 3, '2024-01-01 00:00:00', '2024-05-01 00:00:00', 1, 'NOTE'),
        (6, 4, '2024-01-01 00:00:00', '2024-06-02 00:00:00', 1, 'ANNOT'),
        (7, 1, '2024-01-01 00:00:00', '2025-01-01 00:00:00', 1, 'NEWEST');

    insert into deletedItems (itemID, dateDeleted)
      values (3, '2024-03-02 00:00:00');

    insert into itemDataValues (valueID, value)
      values
        (100, 'Alpha kernels'),
        (101, 'Journal of Kernels'),
        (102, 'Chapter title'),
        (103, 'Collected Essays'),
        (104, 'Deleted item'),
        (105, 'Attachment item'),
        (106, 'Note item'),
        (107, 'Annotation item'),
        (108, 'Newest article'),
        (109, 'Latest journal');

    insert into itemData (itemID, fieldID, valueID)
      values
        (1, 10, 100),
        (1, 13, 101),
        (2, 10, 102),
        (2, 20, 103),
        (3, 10, 104),
        (4, 10, 105),
        (5, 10, 106),
        (6, 10, 107),
        (7, 10, 108),
        (7, 13, 109);
  `);
}
