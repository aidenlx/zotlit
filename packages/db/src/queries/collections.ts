import { defineQuery } from "./_shared";

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
