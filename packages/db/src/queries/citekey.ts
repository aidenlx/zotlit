import {
  itemData,
  items,
  itemDataValues,
  fieldsCombined,
  deletedItems,
} from "@drizzle/schema";
import { eq, sql } from "drizzle-orm";

import type { NodeDatabaseClient } from "@/client/node";
import { formatIndexedKey } from "@/lib/zt-key";

import { groupIDForLibrary } from "./_groups";
import { defineQuery } from "./_shared";
import type { QueryRow } from "./_shared";

/** Zotero's native citation-key field name in Zotero's `fieldsCombined`. */
const CITEKEY_FIELD = "citationKey";

const itemIDByCitekeyQuery = defineQuery<{
  libraryID: number;
  citekey: string;
}>()((db, { placeholder }) =>
  db.query.itemData.findMany({
    where: {
      fieldsCombined: { fieldName: CITEKEY_FIELD },
      itemDataValue: { value: placeholder("citekey") },
      item: {
        libraryID: placeholder("libraryID"),
        deletedItem: false,
      },
    },
    columns: { itemID: true },
    limit: 1,
  }),
);

/**
 * Resolve the Zotero `itemID` whose native citation key equals `citekey`
 * within `libraryID`, or `null` when no live item matches.
 */
export function getItemIDByCitekey(
  db: NodeDatabaseClient,
  libraryID: number,
  citekey: string,
): number | null {
  return (
    itemIDByCitekeyQuery.prepared(db).all({ libraryID, citekey })[0]?.itemID ??
    null
  );
}

const citekeyByItemKeyQuery = defineQuery<{
  libraryID: number;
  key: string;
}>()((db, { placeholder }) =>
  db.query.itemData.findMany({
    where: {
      fieldsCombined: { fieldName: CITEKEY_FIELD },
      item: {
        key: placeholder("key"),
        libraryID: placeholder("libraryID"),
        deletedItem: false,
      },
    },
    columns: {},
    with: { itemDataValue: { columns: { value: true } } },
    limit: 1,
  }),
);

/**
 * Resolve the native citation key of the live item with `key` within
 * `libraryID`, or `null` when no live item matches or it has no citation key.
 * The forward mirror of {@link getItemIDByCitekey}.
 */
export function getCitekeyByItemKey(
  db: NodeDatabaseClient,
  libraryID: number,
  key: string,
): string | null {
  return (
    citekeyByItemKeyQuery.prepared(db).all({ libraryID, key })[0]?.itemDataValue
      ?.value ?? null
  );
}

/** One live item of the citation library that carries a native citation key. */
export interface LibraryCitekey {
  itemID: number;
  /** Local id of the library holding the item, which names that library. */
  libraryID: number;
  /** Bare Zotero item key. */
  key: string;
  /** `key`, or `key` + `g` + groupID for a group library. */
  indexedKey: string;
  /** Its native Zotero citation key. */
  citekey: string;
}

const citekeysByLibraryQuery = defineQuery<{ libraryID: number }>()(
  (db, { placeholder }) =>
    db.query.itemData.findMany({
      where: {
        fieldsCombined: { fieldName: CITEKEY_FIELD },
        item: {
          libraryID: placeholder("libraryID"),
          deletedItem: false,
        },
      },
      columns: { itemID: true },
      with: {
        item: { columns: { key: true } },
        itemDataValue: { columns: { value: true } },
      },
      // Deterministic row order, so "first row wins" for a duplicated
      // citekey does not depend on SQLite's plan and cannot flip between
      // rebuilds.
      orderBy: { itemID: "asc" },
    }),
);

const citekeyWindowQuery = defineQuery<{
  afterItemID: number;
  throughItemID: number;
}>()((db, { placeholder }) =>
  db
    .select({
      itemID: sql<number>`${itemData.itemID}`,
      libraryID: items.libraryID,
      key: items.key,
      citekey: sql<string>`${itemDataValues.value}`,
    })
    .from(itemData)
    .innerJoin(items, eq(items.itemID, itemData.itemID))
    .innerJoin(itemDataValues, eq(itemDataValues.valueID, itemData.valueID))
    // Unary + keeps SQLite on the itemID range index and avoids a page sort.
    .where(sql`
      ${itemData.itemID} > ${placeholder("afterItemID")}
      and ${itemData.itemID} <= ${placeholder("throughItemID")}
      and ${itemDataValues.value} <> ''
      and not exists (select 1 from ${deletedItems} where ${deletedItems.itemID} = ${itemData.itemID})
      and +${itemData.fieldID} = (select ${fieldsCombined.fieldID} from ${fieldsCombined} where ${fieldsCombined.fieldName} = ${CITEKEY_FIELD})
    `)
    .orderBy(itemData.itemID),
);

export type CitekeyRow = QueryRow<typeof citekeyWindowQuery>;

/** Every live Item with a native citation key, `afterItemID < itemID <= throughItemID`, in itemID order. */
export function getCitekeyWindow(
  db: NodeDatabaseClient,
  window: { afterItemID: number; throughItemID: number },
): CitekeyRow[] {
  return citekeyWindowQuery.prepared(db).all(window);
}

/**
 * Bulk-read every live item of `libraryID` that carries a native citation
 * key — the one read the Citation Index's resolution snapshot rebuilds from.
 */
export function getCitekeysByLibrary(
  db: NodeDatabaseClient,
  libraryID: number,
): LibraryCitekey[] {
  return toLibraryCitekeys(
    citekeysByLibraryQuery.prepared(db).all({ libraryID }),
    libraryID,
    groupIDForLibrary(db, libraryID),
  );
}

function toLibraryCitekeys(
  rows: readonly QueryRow<typeof citekeysByLibraryQuery>[],
  libraryID: number,
  groupID: number | null,
): LibraryCitekey[] {
  const citekeys: LibraryCitekey[] = [];
  for (const row of rows) {
    const citekey = row.itemDataValue?.value;
    if (!citekey) continue;
    const key = row.item?.key;
    if (!key) continue;
    if (row.itemID == null) continue;
    citekeys.push({
      itemID: row.itemID,
      libraryID,
      key,
      indexedKey: formatIndexedKey(key, groupID),
      citekey,
    });
  }
  return citekeys;
}

const lastItemIDQuery = defineQuery<void>()((db) =>
  db
    .select({ itemID: sql<number>`coalesce(max(${items.itemID}), 0)` })
    .from(items),
);

/** The largest itemID in the database, or 0 when it has no Items. */
export function getLastItemID(db: NodeDatabaseClient): number {
  return lastItemIDQuery.prepared(db).all()[0]!.itemID;
}
