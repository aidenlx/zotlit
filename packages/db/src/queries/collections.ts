import type { NodeDatabaseClient } from "@/client/node";

import { defineQuery } from "./_shared";
import type { QueryRow } from "./_shared";

/**
 * Collection memberships for one item, trashed collections excluded. A trashed
 * collection keeps its `collectionItems` rows (Zotero only inserts the subtree
 * into `deletedCollections`), so the `collection: { deletedCollection: false }`
 * filter is what drops them; `item: { deletedItem: false }` mirrors the tags query.
 */
export const collectionIDsByItemQuery = defineQuery<{ itemID: number }>()(
  (db, { placeholder }) =>
    db.query.collectionItems.findMany({
      where: {
        itemID: placeholder("itemID"),
        item: { deletedItem: false },
        collection: { deletedCollection: false },
      },
      columns: { collectionID: true },
    }),
);

/**
 * All non-trashed collection nodes in one library — bulk-loaded once per library
 * so `CollectionCache` can resolve ancestor paths in-memory. A live node
 * may still reference a trashed parent (Zotero's restore/reparent allow it), so
 * the in-memory walk truncates at any `parentCollectionID` absent from this set.
 */
export const collectionNodesByLibraryQuery = defineQuery<{
  libraryID: number;
}>()((db, { placeholder }) =>
  db.query.collections.findMany({
    where: {
      libraryID: placeholder("libraryID"),
      deletedCollection: false,
    },
    columns: {
      collectionID: true,
      collectionName: true,
      parentCollectionID: true,
      key: true,
    },
  }),
);

/** One live collection node of a library, with the columns a tree walk needs. */
export type CollectionNode = QueryRow<typeof collectionNodesByLibraryQuery>;

/** Every non-trashed collection of one library, unordered. */
export function getCollectionNodesByLibrary(
  db: NodeDatabaseClient,
  libraryID: number,
): CollectionNode[] {
  return collectionNodesByLibraryQuery.prepared(db).all({ libraryID });
}

/**
 * Ids of the collections one live item is filed in directly — its actual
 * memberships, whatever collection a UI currently shows it under. Trashed
 * collections are excluded; a trashed item has none.
 */
export function getCollectionIDsByItem(
  db: NodeDatabaseClient,
  itemID: number,
): number[] {
  return collectionIDsByItemQuery
    .prepared(db)
    .all({ itemID })
    .map((row) => row.collectionID);
}
