import type { NodeDatabaseClient } from "@/client/node";

import { defineQuery } from "./_shared";

/** Better BibTeX's native citation-key field name in Zotero's `fieldsCombined`. */
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
 * Resolve the Zotero `itemID` whose Better BibTeX citation key equals `citekey`
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
 * Resolve the Better BibTeX citation key of the live item with `key` within
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
