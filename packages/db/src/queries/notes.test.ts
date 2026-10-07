import { relations } from "@drizzle/relations";
import { drizzle } from "drizzle-orm/node-sqlite";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { NodeDatabaseClient } from "@/client/node";
import { createFixtureSchema } from "@/test-utils";

import { getChildNotesByParentIDs, getNoteRefsByItemIDs } from "./notes";

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

describe("getNoteRefsByItemIDs", () => {
  it("maps each note id to its ref, flagging a note in the trash", () => {
    const refs = getNoteRefsByItemIDs(db, [200, 300, 100, 999, 100]);
    expect(
      [...refs].map(([itemID, { note, trashed }]) => [
        itemID,
        note.key,
        trashed,
      ]),
    ).toEqual([
      [100, "LIVE", false],
      [200, "TRASHED", true],
    ]);
  });

  it("carries the note's identity and title", () => {
    expect(getNoteRefsByItemIDs(db, [402]).get(402)?.note).toMatchObject({
      itemID: 402,
      libraryID: 1,
      groupID: null,
      parentItemID: 301,
      key: "CHILD003",
      indexedKey: "CHILD003",
      title: "Three",
    });
  });

  it("returns an empty map for empty input", () => {
    expect(getNoteRefsByItemIDs(db, [])).toEqual(new Map());
  });
});

describe("getChildNotesByParentIDs", () => {
  it("lists each parent's live child notes in the order the parents are asked", () => {
    const notes = getChildNotesByParentIDs(db, [301, 300, 999]);
    expect(
      notes.map(({ itemID, parentItemID }) => [parentItemID, itemID]),
    ).toEqual([
      [301, 402],
      [300, 400],
      [300, 401],
    ]);
  });

  it("returns no notes for empty input", () => {
    expect(getChildNotesByParentIDs(db, [])).toEqual([]);
  });
});

function seed(sqlite: DatabaseSync): void {
  createFixtureSchema(sqlite);
  sqlite.exec(`
    insert into items (itemID, itemTypeID, dateAdded, dateModified, libraryID, key)
      values
        (100, 1, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 1, 'LIVE'),
        (200, 1, '2024-01-02 00:00:00', '2024-01-02 00:00:00', 1, 'TRASHED'),
        (300, 2, '2024-01-03 00:00:00', '2024-01-03 00:00:00', 1, 'NOTANOTE'),
        (301, 2, '2024-01-03 00:00:00', '2024-01-03 00:00:00', 1, 'PARENT02'),
        (400, 1, '2024-01-04 00:00:00', '2024-01-04 00:00:00', 1, 'CHILD001'),
        (401, 1, '2024-01-04 00:00:00', '2024-01-04 00:00:00', 1, 'CHILD002'),
        (402, 1, '2024-01-04 00:00:00', '2024-01-04 00:00:00', 1, 'CHILD003'),
        (403, 1, '2024-01-04 00:00:00', '2024-01-04 00:00:00', 1, 'CHILDDEL');

    insert into itemNotes (itemID, parentItemID, note, title)
      values
        (100, null, '<p>Live note</p>', 'Live'),
        (200, null, '<p>Trashed note</p>', 'Trashed'),
        (400, 300, '<p>One</p>', 'One'),
        (401, 300, '<p>Two</p>', 'Two'),
        (402, 301, '<p>Three</p>', 'Three'),
        (403, 300, '<p>Gone</p>', 'Gone');

    insert into deletedItems (itemID, dateDeleted)
      values (200, '2024-01-02 00:00:01'), (403, '2024-01-04 00:00:01');
  `);
}
