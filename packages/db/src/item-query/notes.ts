// The Child Notes of Items: the Relation List reader of Item Query.
import { itemNotes, items, itemTypesCombined } from "@drizzle/schema";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { Effect } from "effect";

import { defineStatement, idSlots } from "./database";
import type { IdSlot } from "./database";
import { HYDRATE_CHUNK_SIZE } from "./hydrate-chunk";
import { recordUniverse } from "./record-universe";
import type { ScanRow } from "./scan-page";

const parent = alias(items, "noteParent");

/** A Child Note identity, its title, and its parent Item. */
export interface NoteScanRow extends ScanRow {
  libraryID: number;
  title: string | null;
  parent: ScanRow;
}

const slots = idSlots(HYDRATE_CHUNK_SIZE);
/**
 * The live Child Notes of a chunk of parent Items, in note key order. An
 * Attachment's own note has no parent in `itemNotes`, so it is not a Child Note.
 */
const itemNotesStatement = defineStatement<Record<IdSlot, number | null>>(
  "item-notes",
)((db, { placeholder }) =>
  db
    .select({
      itemID: items.itemID,
      key: items.key,
      itemType: sql<string>`'note'`,
      dateAdded: sql<number | null>`unixepoch(${items.dateAdded}) * 1000`,
      dateModified: sql<number | null>`unixepoch(${items.dateModified}) * 1000`,
      libraryID: items.libraryID,
      title: itemNotes.title,
      parent: {
        itemID: parent.itemID,
        key: parent.key,
        itemType: itemTypesCombined.typeName,
        dateAdded: sql<number | null>`unixepoch(${parent.dateAdded}) * 1000`,
        dateModified: sql<
          number | null
        >`unixepoch(${parent.dateModified}) * 1000`,
      },
    })
    .from(items)
    .innerJoin(itemNotes, eq(itemNotes.itemID, items.itemID))
    .innerJoin(parent, eq(parent.itemID, itemNotes.parentItemID))
    .innerJoin(
      itemTypesCombined,
      eq(itemTypesCombined.itemTypeID, parent.itemTypeID),
    )
    .where(
      and(
        inArray(
          parent.itemID,
          slots.names.map((name) => placeholder(name)),
        ),
        ...recordUniverse(db, [items, parent], false),
      ),
    )
    .orderBy(asc(items.key)),
);

export function readItemNotes(itemIDs: readonly number[]) {
  if (itemIDs.length > HYDRATE_CHUNK_SIZE)
    return Effect.die(
      new RangeError("A relation chunk holds at most 250 parent IDs."),
    );
  return itemIDs.length
    ? itemNotesStatement.all(slots.bind(itemIDs))
    : Effect.succeed([] as NoteScanRow[]);
}
