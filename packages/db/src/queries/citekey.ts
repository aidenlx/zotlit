import type { NodeDatabaseClient } from "@/client/node";
import { formatIndexedKey } from "@/lib/zt-key";

import { groupIDForLibrary } from "./_groups";
import { defineQuery } from "./_shared";

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

/**
 * Bulk-read every live item of `libraryID` that carries a native citation
 * key — the one read the Citation Index's resolution snapshot rebuilds from.
 */
export function getCitekeysByLibrary(
  db: NodeDatabaseClient,
  libraryID: number,
): LibraryCitekey[] {
  const groupID = groupIDForLibrary(db, libraryID);
  const rows: LibraryCitekey[] = [];
  for (const row of citekeysByLibraryQuery.prepared(db).all({ libraryID })) {
    const citekey = row.itemDataValue?.value;
    if (!citekey) continue;
    const key = row.item?.key;
    if (!key) continue;
    if (row.itemID == null) continue;
    rows.push({
      itemID: row.itemID,
      key,
      indexedKey: formatIndexedKey(key, groupID),
      citekey,
    });
  }
  return rows;
}
