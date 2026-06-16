import { type NodeDatabaseClient } from "@/client/node";
import { type SQLocalDatabaseClient } from "@/client/web";

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

export async function getItemIDByCitekeyAsync(
  db: SQLocalDatabaseClient,
  libraryID: number,
  citekey: string,
): Promise<number | null> {
  const [row] = await itemIDByCitekeyQuery
    .prepared(db)
    .all({ libraryID, citekey });
  return row?.itemID ?? null;
}
