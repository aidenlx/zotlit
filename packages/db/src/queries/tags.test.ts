import { relations } from "@drizzle/relations";
import { drizzle } from "drizzle-orm/node-sqlite";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type NodeDatabaseClient } from "@/client/node";
import { tagTypeToName } from "@/lib/zt-tag";

import {
  getTagsByItemIDs,
  resolveItemTags,
  resolveItemTagsByIDs,
  type TagMemo,
} from "./tags";

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

describe("getTagsByItemIDs", () => {
  it("returns tags tagged with their itemID, alphabetic within each item group", () => {
    const result = getTagsByItemIDs(db, [1, 2]);

    expect(result.map((t) => [t.itemID, t.tag.name])).toEqual([
      [1, "alpha"],
      [1, "beta"],
      [2, "alpha"],
      [2, "gamma"],
    ]);
  });

  it("preserves itemTags.type per application (0=manual, 1=automatic)", () => {
    const byName = new Map(
      getTagsByItemIDs(db, [1]).map((t) => [t.tag.name, t.type]),
    );

    expect(byName.get("alpha")).toBe(0);
    expect(byName.get("beta")).toBe(1);
    expect(tagTypeToName(byName.get("beta")!)).toBe("auto");
  });

  it("excludes tags whose item is deleted", () => {
    expect(getTagsByItemIDs(db, [3])).toEqual([]);
  });

  it("returns tags for an item by global id regardless of its library", () => {
    expect(
      getTagsByItemIDs(db, [4]).map((t) => [t.itemID, t.tag.name]),
    ).toEqual([[4, "alpha"]]);
  });

  it("returns an empty array when no item has tags", () => {
    expect(getTagsByItemIDs(db, [999])).toEqual([]);
  });

  it("returns an empty array for empty input", () => {
    expect(getTagsByItemIDs(db, [])).toEqual([]);
  });

  it("returns item-tag applications with nested tag records", () => {
    const [first] = getTagsByItemIDs(db, [1]);

    expect(first).toEqual({
      itemID: 1,
      tag: { tagID: 10, name: "alpha" },
      type: 0,
    });
  });

  it("reuses the same tag record object for shared tags", () => {
    const result = getTagsByItemIDs(db, [1, 2]);
    const item1Alpha = result.find(
      (itemTag) => itemTag.itemID === 1 && itemTag.tag.name === "alpha",
    );
    const item2Alpha = result.find(
      (itemTag) => itemTag.itemID === 2 && itemTag.tag.name === "alpha",
    );

    expect(item2Alpha?.tag).toBe(item1Alpha?.tag);
  });
});

describe("TagMemo", () => {
  it("resolves an item's tags via resolveItemTags and resolveItemTagsByIDs", () => {
    const memo: TagMemo = new Map();

    expect(resolveItemTags(db, 1, memo).map((t) => t.tag.name)).toEqual([
      "alpha",
      "beta",
    ]);
    expect(
      [...resolveItemTagsByIDs(db, [1, 2], memo).entries()].map(
        ([itemID, tags]) => [itemID, tags.map((t) => t.tag.name)],
      ),
    ).toEqual([
      [1, ["alpha", "beta"]],
      [2, ["alpha", "gamma"]],
    ]);
  });

  it("memoizes per itemID: a repeat call skips the query", () => {
    const memo: TagMemo = new Map();
    expect(resolveItemTags(db, 1, memo).map((t) => t.tag.name)).toEqual([
      "alpha",
      "beta",
    ]);

    // Mutating the underlying rows must not affect a repeat call for the same
    // itemID — proof the second call reused the first's result.
    sqlite.exec("delete from itemTags where itemID = 1");

    expect(resolveItemTags(db, 1, memo).map((t) => t.tag.name)).toEqual([
      "alpha",
      "beta",
    ]);
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
    create table tags (
      tagID integer primary key,
      name text not null
    );
    create table itemTags (
      itemID integer not null,
      tagID integer not null,
      type integer not null,
      primary key (itemID, tagID)
    );
    create table deletedItems (
      itemID integer primary key,
      dateDeleted text not null
    );

    insert into items (itemID, itemTypeID, dateAdded, dateModified, libraryID, key)
      values
        (1, 1, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 1, 'ITEM1'),
        (2, 1, '2024-01-02 00:00:00', '2024-01-02 00:00:00', 1, 'ITEM2'),
        (3, 1, '2024-01-03 00:00:00', '2024-01-03 00:00:00', 1, 'TRASH'),
        (4, 1, '2024-01-04 00:00:00', '2024-01-04 00:00:00', 2, 'OTHER');

    insert into tags (tagID, name)
      values
        (10, 'alpha'),
        (11, 'beta'),
        (12, 'gamma'),
        (13, 'delta');

    insert into itemTags (itemID, tagID, type)
      values
        (1, 11, 1),
        (1, 10, 0),
        (2, 10, 0),
        (2, 12, 0),
        (3, 13, 0),
        (4, 10, 0);

    insert into deletedItems (itemID, dateDeleted)
      values (3, '2024-01-03 00:00:01');
  `);
}
