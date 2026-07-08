import { relations } from "@drizzle/relations";
import { drizzle } from "drizzle-orm/node-sqlite";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type NodeDatabaseClient } from "@/client/node";
import { USER_LIBRARY_ID } from "@/lib/constants";
import { createFixtureSchema } from "@/test-utils";

import {
  getItemDisplayInfoByID,
  getItemDisplayRefByID,
  getItemRefByID,
} from "./item-ref";

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

describe("getItemRefByID", () => {
  it("resolves a user-library item to its key and library, no scope needed", () => {
    expect(getItemRefByID(db, 1)).toEqual({
      itemID: 1,
      key: "USER1",
      libraryID: USER_LIBRARY_ID,
      groupID: null,
      indexedKey: "USER1",
    });
  });

  it("attaches the group id and indexed key for a group-library item", () => {
    expect(getItemRefByID(db, 7)).toEqual({
      itemID: 7,
      key: "GRP1",
      libraryID: 2,
      groupID: 17,
      indexedKey: "GRP1g17",
    });
  });

  it("returns null for a deleted item", () => {
    expect(getItemRefByID(db, 2)).toBeNull();
  });

  it("returns null for an unknown item id", () => {
    expect(getItemRefByID(db, 9999)).toBeNull();
  });
});

describe("getItemDisplayRefByID", () => {
  it("resolves a user-library item to its ref plus title", () => {
    expect(getItemDisplayRefByID(db, 1)).toEqual({
      itemID: 1,
      key: "USER1",
      libraryID: USER_LIBRARY_ID,
      groupID: null,
      indexedKey: "USER1",
      title: "Alpha kernels",
    });
  });

  it("returns a null title when the item has no title field", () => {
    expect(getItemDisplayRefByID(db, 6)).toEqual({
      itemID: 6,
      key: "USER2",
      libraryID: USER_LIBRARY_ID,
      groupID: null,
      indexedKey: "USER2",
      title: null,
    });
  });

  it("attaches the group id and indexed key for a group-library item", () => {
    expect(getItemDisplayRefByID(db, 7)).toEqual({
      itemID: 7,
      key: "GRP1",
      libraryID: 2,
      groupID: 17,
      indexedKey: "GRP1g17",
      title: "Group paper",
    });
  });

  it("returns null for a deleted item", () => {
    expect(getItemDisplayRefByID(db, 2)).toBeNull();
  });

  it("returns null for an unknown item id", () => {
    expect(getItemDisplayRefByID(db, 9999)).toBeNull();
  });
});

describe("getItemDisplayInfoByID", () => {
  it("loads title and year from itemData, ignoring other stored fields", () => {
    const result = getItemDisplayInfoByID(db, 1);

    // USER1 also stores citationKey, publicationTitle, volume, issue, pages,
    // language, and a custom mood field — the display query must pick only
    // title and date.
    expect(result).toEqual({
      title: "Alpha kernels",
      year: 2024,
      creators: [
        { firstName: "Jane", lastName: "Doe", fieldMode: 0 },
        { firstName: "Richard", lastName: "Roe", fieldMode: 0 },
      ],
    });
  });

  it("returns null title and year when the item has no title or date rows", () => {
    expect(getItemDisplayInfoByID(db, 6)).toEqual({
      title: null,
      year: null,
      creators: [],
    });
  });

  it("extracts year from a year-only Zotero date string", () => {
    expect(getItemDisplayInfoByID(db, 7)).toEqual({
      title: "Group paper",
      year: 2025,
      creators: [{ firstName: null, lastName: "Research Group", fieldMode: 1 }],
    });
  });

  it("returns null for a deleted item", () => {
    expect(getItemDisplayInfoByID(db, 2)).toBeNull();
  });

  it("returns null for an unknown item id", () => {
    expect(getItemDisplayInfoByID(db, 9999)).toBeNull();
  });

  it("reuses the prepared statement across itemID values", () => {
    const user1 = getItemDisplayInfoByID(db, 1);
    const user2 = getItemDisplayInfoByID(db, 6);

    expect(user1?.title).toBe("Alpha kernels");
    expect(user2?.title).toBeNull();

    expect(getItemDisplayInfoByID(db, 1)?.title).toBe("Alpha kernels");
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
      values
        (1, 'journalArticle'),
        (2, 'attachment'),
        (3, 'note'),
        (4, 'annotation'),
        (5, 'book');

    insert into fieldsCombined (fieldID, fieldName, custom)
      values
        (10, 'title', 0),
        (11, 'citationKey', 0),
        (12, 'date', 0),
        (13, 'publicationTitle', 0),
        (14, 'volume', 0),
        (15, 'issue', 0),
        (16, 'pages', 0),
        (17, 'language', 0),
        (18, 'mood', 1);

    insert into items (itemID, itemTypeID, dateAdded, dateModified, libraryID, key)
      values
        (1, 1, '2024-01-01 00:00:00', '2024-02-01 00:00:00', 1, 'USER1'),
        (2, 1, '2024-01-01 00:00:00', '2024-03-01 00:00:00', 1, 'DELETED'),
        (3, 2, '2024-01-01 00:00:00', '2024-04-01 00:00:00', 1, 'ATTACH'),
        (4, 3, '2024-01-01 00:00:00', '2024-05-01 00:00:00', 1, 'NOTE'),
        (5, 4, '2024-01-01 00:00:00', '2024-06-01 00:00:00', 1, 'ANNOT'),
        (6, 5, '2024-01-01 00:00:00', '2024-07-01 00:00:00', 1, 'USER2'),
        (7, 1, '2024-01-01 00:00:00', '2025-01-01 00:00:00', 2, 'GRP1');

    insert into deletedItems (itemID, dateDeleted)
      values (2, '2024-03-02 00:00:00');

    insert into itemDataValues (valueID, value)
      values
        (100, 'Alpha kernels'),
        (101, 'doe2024alpha'),
        (102, '2024-02-03 February 3, 2024'),
        (103, 'Deleted item'),
        (104, 'Attachment item'),
        (105, 'Note item'),
        (106, 'Annotation item'),
        (107, 'Group paper'),
        (108, 'group2025paper'),
        (109, '2025-00-00 2025'),
        (110, 'Journal of Kernels'),
        (111, '12'),
        (112, '3'),
        (113, '45-67'),
        (114, 'English'),
        (115, 'en_US'),
        (116, 'curious');

    insert into itemData (itemID, fieldID, valueID)
      values
        (1, 10, 100),
        (1, 11, 101),
        (1, 12, 102),
        (1, 13, 110),
        (1, 14, 111),
        (1, 15, 112),
        (1, 16, 113),
        (1, 18, 116),
        (2, 10, 103),
        (3, 10, 104),
        (4, 10, 105),
        (5, 10, 106),
        (1, 17, 114),
        (7, 10, 107),
        (7, 11, 108),
        (7, 12, 109),
        (7, 17, 115);

    insert into creatorTypes (creatorTypeID, creatorType)
      values (1, 'author'), (2, 'editor');
    insert into creators (creatorID, firstName, lastName, fieldMode)
      values
        (1, 'Jane', 'Doe', 0),
        (2, 'Richard', 'Roe', 0),
        (3, null, 'Research Group', 1);
    insert into itemCreators (itemID, creatorID, creatorTypeID, orderIndex)
      values (1, 2, 2, 1), (1, 1, 1, 0), (7, 3, 1, 0);
    insert into itemTypeCreatorTypes (itemTypeID, creatorTypeID, primaryField)
      values
        (1, 1, 1), (1, 2, 0),
        (5, 1, 1), (5, 2, 0);
  `);
}
