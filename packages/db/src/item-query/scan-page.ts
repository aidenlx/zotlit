import { deletedItems, items, itemTypesCombined } from "@drizzle/schema";
import { and, asc, eq, gt, notExists, notInArray } from "drizzle-orm";
import type { Effect } from "effect";

import { CHILD_ITEM_TYPES } from "@/lib/item-types";

import { defineStatement } from "./database";
import type { ItemQueryDatabase, ItemQueryReaderError } from "./database";

/** The Items one scan statement reads at most. */
export const SCAN_PAGE_SIZE = 500;

/** One Item of the query universe, as the Library scan reads it. */
export interface ScanRow {
  itemID: number;
  key: string;
  itemType: string;
  dateAdded: Temporal.Instant;
  dateModified: Temporal.Instant;
}

const scanPageStatement = defineStatement<{
  libraryID: number;
  afterKey: string;
  limit: number;
}>()((db, { placeholder }) =>
  db
    .select({
      itemID: items.itemID,
      key: items.key,
      itemType: itemTypesCombined.typeName,
      dateAdded: items.dateAdded,
      dateModified: items.dateModified,
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
