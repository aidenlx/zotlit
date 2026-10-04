import { deletedItems, items, itemTypesCombined } from "@drizzle/schema";
import {
  and,
  asc,
  eq,
  gt,
  inArray,
  notExists,
  notInArray,
  sql,
} from "drizzle-orm";
import type { AnyColumn, SQL } from "drizzle-orm";
import { Effect } from "effect";

import { CHILD_ITEM_TYPES } from "@/lib/item-types";

import { defineStatement, unindexed } from "./database";
import type { ItemQueryDatabase, ItemQueryReaderError } from "./database";

/** The Items one scan statement reads at most. */
export const SCAN_PAGE_SIZE = 500;

/** One Item of the query universe, as the Library scan reads it. */
export interface ScanRow {
  itemID: number;
  key: string;
  itemType: string;
  /**
   * The Unix time in milliseconds. A scan reads every Item of the Library, so
   * a row holds a number: a `Temporal.Instant` for each row fills the young
   * heap, and its collections are long pauses in the Obsidian window.
   */
  dateAdded: number;
  dateModified: number;
}

/** A timestamp column of `items` as its Unix time in milliseconds. */
function epochMilliseconds(column: AnyColumn): SQL<number> {
  return sql<number>`unixepoch(${column}) * 1000`;
}

const scanPageStatement = defineStatement<{
  libraryID: number;
  afterKey: string;
  limit: number;
}>("scan-page")((db, { placeholder }) =>
  db
    .select({
      itemID: items.itemID,
      key: items.key,
      itemType: itemTypesCombined.typeName,
      dateAdded: epochMilliseconds(items.dateAdded),
      dateModified: epochMilliseconds(items.dateModified),
    })
    .from(items)
    .innerJoin(
      itemTypesCombined,
      eq(itemTypesCombined.itemTypeID, items.itemTypeID),
    )
    .where(
      and(
        eq(items.libraryID, placeholder("libraryID")),
        gt(items.key, placeholder("afterKey")),
        notInArray(itemTypesCombined.typeName, [...CHILD_ITEM_TYPES]),
        notExists(
          db
            .select({ itemID: deletedItems.itemID })
            .from(deletedItems)
            .where(eq(deletedItems.itemID, items.itemID)),
        ),
      ),
    )
    .orderBy(asc(items.key))
    .limit(placeholder("limit")),
);

/**
 * Read one keyset page of the query universe: the top-level, non-trashed Items
 * of one Library, in key order, after `afterKey` (`null` for the first page).
 * A page holds at most {@link SCAN_PAGE_SIZE} Items; a shorter page than the
 * requested size is the last one.
 */
export function readScanPage(page: {
  libraryID: number;
  afterKey: string | null;
  /** Defaults to {@link SCAN_PAGE_SIZE}, which is also its upper limit. */
  size?: number;
}): Effect.Effect<ScanRow[], ItemQueryReaderError, ItemQueryDatabase> {
  return scanPageStatement.all({
    libraryID: page.libraryID,
    afterKey: page.afterKey ?? "",
    limit: Math.min(page.size ?? SCAN_PAGE_SIZE, SCAN_PAGE_SIZE),
  });
}

const ID_SLOTS = Array.from(
  { length: SCAN_PAGE_SIZE },
  (_, i) => `id${i}` as const,
);

const universeRowsStatement = defineStatement<Record<string, number | null>>(
  "universe-rows",
)((db, { placeholder }) =>
  db
    .select({
      itemID: items.itemID,
      key: items.key,
      itemType: itemTypesCombined.typeName,
      dateAdded: epochMilliseconds(items.dateAdded),
      dateModified: epochMilliseconds(items.dateModified),
    })
    .from(items)
    .innerJoin(
      itemTypesCombined,
      eq(itemTypesCombined.itemTypeID, items.itemTypeID),
    )
    .where(
      and(
        inArray(
          items.itemID,
          ID_SLOTS.map((slot) => placeholder(slot)),
        ),
        eq(unindexed(items.libraryID), placeholder("libraryID")),
        notInArray(itemTypesCombined.typeName, [...CHILD_ITEM_TYPES]),
        notExists(
          db
            .select({ itemID: deletedItems.itemID })
            .from(deletedItems)
            .where(eq(deletedItems.itemID, items.itemID)),
        ),
      ),
    )
    .orderBy(asc(items.key)),
);

/**
 * Restrict a chunk of Item IDs to the query universe: the row of each ID that
 * is a top-level, non-trashed Item of the Target Library, in key order and in
 * the form of {@link readScanPage}. A chunk holds at most
 * {@link SCAN_PAGE_SIZE} IDs.
 */
export function readUniverseRows(chunk: {
  libraryID: number;
  itemIDs: readonly number[];
}): Effect.Effect<ScanRow[], ItemQueryReaderError, ItemQueryDatabase> {
  const { libraryID, itemIDs } = chunk;
  if (itemIDs.length > SCAN_PAGE_SIZE) {
    return Effect.die(
      new RangeError(
        `A universe chunk holds at most ${SCAN_PAGE_SIZE} Item IDs, not ${itemIDs.length}.`,
      ),
    );
  }
  if (itemIDs.length === 0) return Effect.succeed([]);
  return universeRowsStatement.all({
    libraryID,
    ...Object.fromEntries(
      ID_SLOTS.map((slot, i) => [slot, itemIDs[i] ?? null]),
    ),
  });
}
