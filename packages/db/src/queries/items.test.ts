import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createClient, type NodeDatabaseClient } from "@/client/node";
import { parseItemLanguage } from "@/lib/zt-lang";

import {
  formatIndexedKey,
  getItemsByID,
  getItemsByKey,
  getItemsByLibrary,
} from "./items";

let tempDir: string;
let dbPath: string;
let db: NodeDatabaseClient;

beforeEach(async () => {
  tempDir = join(tmpdir(), `zotlit-db-items-${randomUUID()}`);
  await mkdir(tempDir, { recursive: true });
  dbPath = join(tempDir, "zotero.sqlite");
  seedFixture(dbPath);
  db = createClient(dbPath);
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("getItemsByLibrary", () => {
  it("excludes deleted items via the deletedItem: false predicate", () => {
    const keys = new Set(getItemsByLibrary(db, 1).map((item) => item.key));

    expect(keys.has("DELETED")).toBe(false);
  });

  it("excludes child item types via itemType.typeName notIn predicate", () => {
    const keys = new Set(getItemsByLibrary(db, 1).map((item) => item.key));

    expect(keys.has("ATTACH")).toBe(false);
    expect(keys.has("NOTE")).toBe(false);
    expect(keys.has("ANNOT")).toBe(false);
  });

  it("returns lean non-deleted regular items for the requested library", () => {
    const result = getItemsByLibrary(db, 1);

    expect(result.map((item) => item.key)).toEqual(["USER2", "USER1"]);
    expect(result).toMatchObject([
      {
        itemID: 6,
        libraryID: 1,
        indexedKey: "USER2",
        itemType: "book",
        creators: [],
        fields: new Map(),
      },
      {
        itemID: 1,
        libraryID: 1,
        indexedKey: "USER1",
        itemType: "journalArticle",
        title: "Alpha kernels",
        citationKey: "doe2024alpha",
        date: "2024-02-03 February 3, 2024",
        language: "English",
      },
    ]);
  });

  it("populates journal-article fields and narrows via itemType", () => {
    const result = getItemsByLibrary(db, 1);
    const journal = result.find((item) => item.key === "USER1");
    const book = result.find((item) => item.key === "USER2");

    expect(journal?.itemType).toBe("journalArticle");
    expect(book?.itemType).toBe("book");

    if (!journal || journal.itemType !== "journalArticle") {
      throw new Error("expected USER1 to be a journal article");
    }
    expect(journal).toMatchObject({
      publicationTitle: "Journal of Kernels",
      volume: "12",
      issue: "3",
      pages: "45-67",
    });

    expect(book).not.toHaveProperty("publicationTitle");
  });

  it("leaves journal-article fields absent when Zotero omits them", () => {
    const [item] = getItemsByLibrary(db, 2);
    if (!item || item.itemType !== "journalArticle") {
      throw new Error("expected GRP1 to be a journal article");
    }
    expect(item).not.toHaveProperty("publicationTitle");
    expect(item).not.toHaveProperty("volume");
    expect(item).not.toHaveProperty("issue");
    expect(item).not.toHaveProperty("pages");
  });

  it("keeps custom fields in the leftover map", () => {
    const item = getItemsByLibrary(db, 1).find((i) => i.key === "USER1");

    expect(item?.fields.get("mood")).toBe("curious");
    expect(item?.fields.has("title")).toBe(false);
    expect(item).not.toHaveProperty("mood");
  });

  it("parses dateModified as a UTC instant", () => {
    const [recent, older] = getItemsByLibrary(db, 1);

    // Fixture timestamps are '2024-07-01 00:00:00' (UTC) and
    // '2024-02-01 00:00:00' (UTC) — assert via epoch ms to confirm the UTC
    // interpretation without depending on the runner's local timezone.
    expect(recent?.dateModified.epochMilliseconds).toBe(
      Date.UTC(2024, 6, 1, 0, 0, 0),
    );
    expect(older?.dateModified.epochMilliseconds).toBe(
      Date.UTC(2024, 1, 1, 0, 0, 0),
    );
  });

  it("stitches creators in Zotero order with field mode", () => {
    const [recent, item] = getItemsByLibrary(db, 1);

    expect(recent?.creators).toEqual([]);
    expect(item?.creators).toEqual([
      {
        firstName: "Jane",
        lastName: "Doe",
        creatorType: "author",
        fieldMode: 0,
      },
      {
        firstName: "Richard",
        lastName: "Roe",
        creatorType: "editor",
        fieldMode: 0,
      },
    ]);
  });

  it("precomputes group indexed keys", () => {
    expect(getItemsByLibrary(db, 2)).toMatchObject([
      {
        key: "GRP1",
        indexedKey: "GRP1g17",
        title: "Group paper",
        citationKey: "group2025paper",
        language: "en_US",
        creators: [
          {
            firstName: null,
            lastName: "Research Group",
            creatorType: "author",
            fieldMode: 1,
          },
        ],
      },
    ]);
  });

  it("resolves the primary creator type per item type via itemTypeCreatorTypes", () => {
    const [book, journal] = getItemsByLibrary(db, 1);

    // Both fixture item types (book/journalArticle) have `author` as their
    // primaryField=1 entry, so the extras subquery should pick it for both.
    expect(book?.primaryCreatorType).toBe("author");
    expect(journal?.primaryCreatorType).toBe("author");
  });

  it("resolves itemType via the extras subquery to the typeName string", () => {
    const result = getItemsByLibrary(db, 1);

    // Scalar correlated subquery — each row.itemType must be the raw
    // typeName string, not an array/object from a non-scalar select.
    for (const item of result) {
      expect(typeof item.itemType).toBe("string");
    }
    expect(result.map((item) => [item.key, item.itemType])).toEqual([
      ["USER2", "book"],
      ["USER1", "journalArticle"],
    ]);
  });

  it("reuses the prepared statement across libraryID values", () => {
    // Regression: the prepared-statement cache previously baked in the
    // first caller's libraryID as a literal, so subsequent calls with a
    // different libraryID silently returned the original library's rows.
    // sql.placeholder("libraryID") makes the cached statement parametric.
    const lib1 = getItemsByLibrary(db, 1);
    const lib2 = getItemsByLibrary(db, 2);

    expect(lib1.map((item) => item.key)).toEqual(["USER2", "USER1"]);
    expect(lib2.map((item) => item.key)).toEqual(["GRP1"]);

    // Calling lib 1 again after lib 2 must still return lib 1's rows —
    // proves the placeholder rebinds per call rather than being frozen.
    expect(getItemsByLibrary(db, 1).map((item) => item.key)).toEqual([
      "USER2",
      "USER1",
    ]);
  });

  it("returns raw language so consumers can parse with their own lookup", () => {
    const [, item] = getItemsByLibrary(db, 1);
    if (!item || !("language" in item)) {
      throw new Error("expected USER1 to have a language field");
    }
    const parsed = parseItemLanguage(item.language, (input) =>
      input.toLowerCase() === "english" ? "en" : null,
    );

    expect(item.language).toBe("English");
    expect(parsed).toEqual({
      kind: "iso6391",
      code: "en",
      raw: "English",
    });
  });

  it("formats indexed keys without requiring a database fixture branch", () => {
    expect(formatIndexedKey("ABCD1234", null)).toBe("ABCD1234");
    expect(formatIndexedKey("ABCD1234", undefined)).toBe("ABCD1234");
    expect(formatIndexedKey("ABCD1234", 42)).toBe("ABCD1234g42");
  });
});

describe("getItemsByID", () => {
  it("hydrates only requested regular items from the requested library", () => {
    const result = getItemsByID(db, 1, [1, 6, 2, 3, 7]);
    const byID = new Map(result.map((item) => [item.itemID, item]));

    expect([...byID.keys()].sort((a, b) => a - b)).toEqual([1, 6]);
    expect(byID.get(1)).toMatchObject({
      key: "USER1",
      libraryID: 1,
      title: "Alpha kernels",
      citationKey: "doe2024alpha",
    });
    expect(byID.get(6)).toMatchObject({
      key: "USER2",
      libraryID: 1,
      itemType: "book",
    });
    expect(byID.has(2)).toBe(false);
    expect(byID.has(3)).toBe(false);
    expect(byID.has(7)).toBe(false);
  });

  it("returns an empty array for empty input", () => {
    expect(getItemsByID(db, 1, [])).toEqual([]);
  });
});

describe("getItemsByKey", () => {
  it("hydrates only requested regular items from the requested library", () => {
    const result = getItemsByKey(db, 1, [
      "USER1",
      "USER2",
      "DELETED",
      "ATTACH",
      "GRP1",
    ]);
    const byKey = new Map(result.map((item) => [item.key, item]));

    expect([...byKey.keys()].sort()).toEqual(["USER1", "USER2"]);
    expect(byKey.get("USER1")).toMatchObject({
      itemID: 1,
      libraryID: 1,
      title: "Alpha kernels",
      citationKey: "doe2024alpha",
    });
    expect(byKey.get("USER2")).toMatchObject({
      itemID: 6,
      libraryID: 1,
      itemType: "book",
    });
    expect(byKey.has("DELETED")).toBe(false);
    expect(byKey.has("ATTACH")).toBe(false);
    expect(byKey.has("GRP1")).toBe(false);
  });

  it("returns an empty array for empty input", () => {
    expect(getItemsByKey(db, 1, [])).toEqual([]);
  });

  it("returns an empty array when no key matches", () => {
    expect(getItemsByKey(db, 1, ["NOPE"])).toEqual([]);
  });
});

function seedFixture(path: string): void {
  const sqlite = new DatabaseSync(path);
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
    create table creators (
      creatorID integer primary key,
      firstName text,
      lastName text,
      fieldMode integer
    );
    create table creatorTypes (
      creatorTypeID integer primary key,
      creatorType text
    );
    create table itemCreators (
      itemID integer not null,
      creatorID integer not null,
      creatorTypeID integer not null,
      orderIndex integer not null
    );
    create table itemTypeCreatorTypes (
      itemTypeID integer not null,
      creatorTypeID integer not null,
      primaryField integer,
      primary key (itemTypeID, creatorTypeID)
    );

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

    insert into items (itemID, itemTypeID, dateModified, libraryID, key)
      values
        (1, 1, '2024-02-01 00:00:00', 1, 'USER1'),
        (2, 1, '2024-03-01 00:00:00', 1, 'DELETED'),
        (3, 2, '2024-04-01 00:00:00', 1, 'ATTACH'),
        (4, 3, '2024-05-01 00:00:00', 1, 'NOTE'),
        (5, 4, '2024-06-01 00:00:00', 1, 'ANNOT'),
        (6, 5, '2024-07-01 00:00:00', 1, 'USER2'),
        (7, 1, '2025-01-01 00:00:00', 2, 'GRP1');

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
  sqlite.close();
}
