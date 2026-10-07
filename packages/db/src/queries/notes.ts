// Zotero note (`itemNotes`) lookups: child-note listing and single-note fetch.

import type { NodeDatabaseClient } from "@/client/node";
import { formatIndexedKey } from "@/lib/zt-key";

import { groupIDForLibrary, resolveGroupID } from "./_groups";
import type { GroupIDMemo } from "./_groups";
import { defineQuery } from "./_shared";
import type { FindManyOptions, QueryRow } from "./_shared";

/** A note's identity and staleness stamp, without its HTML body. */
export interface ChildNote {
  groupID: number | null;
  itemID: number;
  libraryID: number;
  key: string;
  /** `key` or `key + 'g' + groupID`, precomputed for NoteIndex lookup. */
  indexedKey: string;
  parentItemID: number | null;
  title: string | null;
  dateModified: Temporal.Instant;
}

/** A note with its stored HTML body, for materializing the imported file. */
export interface Note extends ChildNote {
  note: string | null;
  dateAdded: Temporal.Instant;
}

const childNotesQuery = defineQuery<{ parentItemID: number }>()(
  (db, { placeholder }) =>
    db.query.itemNotes.findMany({
      columns: { title: true, itemID: true, parentItemID: true },
      with: {
        item: { columns: { key: true, libraryID: true, dateModified: true } },
      },
      where: {
        parentItemID: placeholder("parentItemID"),
        item: { deletedItem: false },
      },
      orderBy: { itemID: "asc" },
    }),
);

const noteOptions = {
  columns: { title: true, note: true, itemID: true, parentItemID: true },
  with: {
    item: {
      columns: {
        key: true,
        dateAdded: true,
        dateModified: true,
        libraryID: true,
      },
    },
  },
} satisfies FindManyOptions<"itemNotes">;

const noteByKeyQuery = defineQuery<{ libraryID: number; key: string }>()(
  (db, { placeholder }) =>
    db.query.itemNotes.findMany({
      where: {
        item: {
          key: placeholder("key"),
          libraryID: placeholder("libraryID"),
          deletedItem: false,
        },
      },
      ...noteOptions,
    }),
);

type ChildNoteRow = QueryRow<typeof childNotesQuery>;
type NoteRow = QueryRow<typeof noteByKeyQuery>;

function toChildNote(row: ChildNoteRow, groupID: number | null): ChildNote {
  return {
    itemID: row.itemID,
    libraryID: row.item.libraryID,
    groupID,
    parentItemID: row.parentItemID,
    key: row.item.key,
    indexedKey: formatIndexedKey(row.item.key, groupID),
    title: row.title,
    dateModified: row.item.dateModified,
  };
}

function toNote(row: NoteRow, groupID: number | null): Note {
  return {
    itemID: row.itemID,
    libraryID: row.item.libraryID,
    groupID,
    parentItemID: row.parentItemID,
    key: row.item.key,
    indexedKey: formatIndexedKey(row.item.key, groupID),
    title: row.title,
    note: row.note,
    dateAdded: row.item.dateAdded,
    dateModified: row.item.dateModified,
  };
}

export function getChildNotes(
  db: NodeDatabaseClient,
  parentItemID: number,
  opts?: { memo?: GroupIDMemo },
): ChildNote[] {
  const memo = opts?.memo ?? new Map();
  return childNotesQuery
    .prepared(db)
    .all({ parentItemID })
    .map((row) =>
      toChildNote(row, resolveGroupID(db, row.item.libraryID, memo)),
    );
}

export function getNoteByKey(
  db: NodeDatabaseClient,
  noteKey: string,
  opts: { libraryID: number; memo?: GroupIDMemo },
): Note | null {
  const row = noteByKeyQuery
    .prepared(db)
    .all({ libraryID: opts.libraryID, key: noteKey })[0];
  if (!row) return null;
  return toNote(
    row,
    resolveGroupID(db, opts.libraryID, opts.memo ?? new Map()),
  );
}

const notesByKeysQuery = defineQuery<void>()(
  (db, _operators, args: { libraryID: number; keys: readonly string[] }) =>
    db.query.itemNotes.findMany({
      where: {
        item: {
          key: { in: [...args.keys] },
          libraryID: args.libraryID,
          deletedItem: false,
        },
      },
      ...noteOptions,
    }),
);

/**
 * Fetch notes of one library by key, in one statement, in `keys` order:
 * {@link getNoteByKey} for each key. A key that names no live note has no
 * entry; a repeated key repeats its note. The keys inline into the SQL, so the
 * statement is not cached.
 */
export function getNotesByKey(
  db: NodeDatabaseClient,
  libraryID: number,
  keys: readonly string[],
): Note[] {
  if (keys.length === 0) return [];
  const rows = new Map(
    notesByKeysQuery
      .prepare(db, { libraryID, keys: [...new Set(keys)] })
      .all()
      .map((row) => [row.item.key, row]),
  );
  if (rows.size === 0) return [];
  const groupID = groupIDForLibrary(db, libraryID);
  return keys.flatMap((key) => {
    const row = rows.get(key);
    return row ? [toNote(row, groupID)] : [];
  });
}

// --- Queries for explicit note-import (Stage 9.3) ---

/** A note found by its own item ID, live or in Zotero's trash. */
export interface NoteRef {
  note: ChildNote;
  /** The note's item is in Zotero's trash. */
  trashed: boolean;
}

const noteRefsByItemIdsQuery = defineQuery<void>()(
  (db, _operators, args: { itemIDs: readonly number[] }) =>
    db.query.itemNotes.findMany({
      columns: { title: true, itemID: true, parentItemID: true },
      with: {
        item: {
          columns: { key: true, libraryID: true, dateModified: true },
          with: { deletedItem: { columns: { itemID: true } } },
        },
      },
      where: { itemID: { in: [...args.itemIDs] } },
      orderBy: { itemID: "asc" },
    }),
);

/**
 * Note refs looked up by the notes' own item IDs (`mode=note` classify), in
 * one statement. Each note ID maps to the note's identity and title — enough
 * to label a batch manifest entry and deduplicate against the note index —
 * and to whether the note is in Zotero's trash. An ID that names no note has
 * no entry. The IDs inline into the SQL, so the statement is not cached.
 */
export function getNoteRefsByItemIDs(
  db: NodeDatabaseClient,
  itemIDs: readonly number[],
  opts?: { memo?: GroupIDMemo },
): Map<number, NoteRef> {
  const refs = new Map<number, NoteRef>();
  if (itemIDs.length === 0) return refs;
  const memo = opts?.memo ?? new Map();
  for (const row of noteRefsByItemIdsQuery
    .prepare(db, { itemIDs: [...new Set(itemIDs)] })
    .all()) {
    refs.set(row.itemID, {
      note: toChildNote(row, resolveGroupID(db, row.item.libraryID, memo)),
      trashed: row.item.deletedItem !== null,
    });
  }
  return refs;
}

const childNotesByParentsQuery = defineQuery<void>()(
  (db, _operators, args: { parentItemIDs: readonly number[] }) =>
    db.query.itemNotes.findMany({
      columns: { title: true, itemID: true, parentItemID: true },
      with: {
        item: { columns: { key: true, libraryID: true, dateModified: true } },
      },
      where: {
        parentItemID: { in: [...args.parentItemIDs] },
        item: { deletedItem: false },
      },
      orderBy: { itemID: "asc" },
    }),
);

/**
 * Fetch child notes of multiple parent items (`mode=child`) in one statement:
 * {@link getChildNotes} for each parent, in `parentItemIDs` order. The ids
 * inline into the SQL, so the statement is not cached.
 */
export function getChildNotesByParentIDs(
  db: NodeDatabaseClient,
  parentItemIDs: readonly number[],
  opts?: { memo?: GroupIDMemo },
): ChildNote[] {
  if (parentItemIDs.length === 0) return [];
  const memo = opts?.memo ?? new Map();
  const byParent = Map.groupBy(
    childNotesByParentsQuery
      .prepare(db, { parentItemIDs: [...new Set(parentItemIDs)] })
      .all(),
    (row) => row.parentItemID,
  );
  return parentItemIDs.flatMap((id) =>
    (byParent.get(id) ?? []).map((row) =>
      toChildNote(row, resolveGroupID(db, row.item.libraryID, memo)),
    ),
  );
}
