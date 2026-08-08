// Zotero note (`itemNotes`) lookups: child-note listing and single-note fetch.
import type { Temporal } from "@zotlit/shared/temporal";

import type { NodeDatabaseClient } from "@/client/node";
import { formatIndexedKey } from "@/lib/zt-key";

import { resolveGroupID } from "./_groups";
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

// --- Queries for explicit note-import (Stage 9.3) ---

const noteRefByItemIdQuery = defineQuery<{ itemID: number }>()(
  (db, { placeholder }) =>
    db.query.itemNotes.findMany({
      columns: { title: true, itemID: true, parentItemID: true },
      with: {
        item: { columns: { key: true, libraryID: true, dateModified: true } },
      },
      where: { itemID: placeholder("itemID"), item: { deletedItem: false } },
    }),
);

const noteByItemIdQuery = defineQuery<{ itemID: number }>()(
  (db, { placeholder }) =>
    db.query.itemNotes.findMany({
      where: { itemID: placeholder("itemID"), item: { deletedItem: false } },
      ...noteOptions,
    }),
);

/**
 * Lightweight note refs looked up by the note's own item IDs (`mode=note`
 * classify). Each returned row carries identity and title — enough to label a
 * batch manifest entry and deduplicate against the note index.
 */
export function getNoteRefsByItemIDs(
  db: NodeDatabaseClient,
  itemIDs: readonly number[],
  opts?: { memo?: GroupIDMemo },
): ChildNote[] {
  const memo = opts?.memo ?? new Map();
  return itemIDs.flatMap((itemID) => {
    const row = noteRefByItemIdQuery.prepared(db).all({ itemID })[0];
    if (!row) return [];
    return [toChildNote(row, resolveGroupID(db, row.item.libraryID, memo))];
  });
}

const trashedNoteByItemIdQuery = defineQuery<{ itemID: number }>()(
  (db, { placeholder }) =>
    db.query.itemNotes.findMany({
      columns: { itemID: true },
      where: { itemID: placeholder("itemID"), item: { deletedItem: true } },
    }),
);

/**
 * Item ids among `itemIDs` that are notes currently in Zotero's trash. Used
 * to tell a trashed note apart from a genuine non-note id at `mode=note`
 * classify time — {@link getNoteRefsByItemIDs} filters trashed items out, so
 * it alone can't distinguish the two.
 */
export function getTrashedNoteItemIDs(
  db: NodeDatabaseClient,
  itemIDs: readonly number[],
): Set<number> {
  return new Set(
    itemIDs.filter(
      (itemID) =>
        trashedNoteByItemIdQuery.prepared(db).all({ itemID }).length > 0,
    ),
  );
}

/**
 * Fetch child notes of multiple parent items (`mode=child`). Generalizes
 * {@link getChildNotes} to accept multiple parent IDs, flattening the results.
 */
export function getChildNotesByParentIDs(
  db: NodeDatabaseClient,
  parentItemIDs: readonly number[],
  opts?: { memo?: GroupIDMemo },
): ChildNote[] {
  const memo = opts?.memo ?? new Map();
  return parentItemIDs.flatMap((id) => getChildNotes(db, id, { memo }));
}

/**
 * Fetch a note's full body by its global item ID. Used by the explicit import
 * runner to hydrate one note at a time under the concurrency limiter.
 */
export function getNoteByItemID(
  db: NodeDatabaseClient,
  itemID: number,
  opts?: { memo?: GroupIDMemo },
): Note | null {
  const row = noteByItemIdQuery.prepared(db).all({ itemID })[0];
  if (!row) return null;
  const memo = opts?.memo ?? new Map();
  return toNote(row, resolveGroupID(db, row.item.libraryID, memo));
}
