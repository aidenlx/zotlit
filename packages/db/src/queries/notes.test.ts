import { relations } from "@drizzle/relations";
import { drizzle } from "drizzle-orm/node-sqlite";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type NodeDatabaseClient } from "@/client/node";
import { createFixtureSchema } from "@/test-utils";

import { getTrashedNoteItemIDs } from "./notes";

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

describe("getTrashedNoteItemIDs", () => {
  it("flags a note whose item is in the trash", () => {
    expect(getTrashedNoteItemIDs(db, [200])).toEqual(new Set([200]));
  });

  it("excludes a live note", () => {
    expect(getTrashedNoteItemIDs(db, [100])).toEqual(new Set());
  });

  it("excludes an id that isn't a note at all", () => {
    expect(getTrashedNoteItemIDs(db, [300])).toEqual(new Set());
  });

  it("returns an empty set for empty input", () => {
    expect(getTrashedNoteItemIDs(db, [])).toEqual(new Set());
  });
});

function seed(sqlite: DatabaseSync): void {
  createFixtureSchema(sqlite);
  sqlite.exec(`
    insert into items (itemID, itemTypeID, dateAdded, dateModified, libraryID, key)
      values
        (100, 1, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 1, 'LIVE'),
        (200, 1, '2024-01-02 00:00:00', '2024-01-02 00:00:00', 1, 'TRASHED'),
        (300, 2, '2024-01-03 00:00:00', '2024-01-03 00:00:00', 1, 'NOTANOTE');

    insert into itemNotes (itemID, parentItemID, note, title)
      values
        (100, null, '<p>Live note</p>', 'Live'),
        (200, null, '<p>Trashed note</p>', 'Trashed');

    insert into deletedItems (itemID, dateDeleted)
      values (200, '2024-01-02 00:00:01');
  `);
}
