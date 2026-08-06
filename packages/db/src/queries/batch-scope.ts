// Item-id scope resolution for the batch actions: every item a run covers,
// either across a whole library or across one collection and its descendants.
import {
  collectionItems,
  collections,
  deletedCollections,
  deletedItems,
  itemNotes,
  items,
  itemTypes,
} from "@drizzle/schema";
import {
  and,
  asc,
  desc,
  eq,
  isNull,
  notInArray,
  sql,
  type SQL,
} from "drizzle-orm";

import { type NodeDatabaseClient } from "@/client/node";

import {
  CHILD_ITEM_TYPES,
  defineQuery,
  type ParamsPlaceholder,
} from "./_shared";

/** Placeholders every collection-scoped query in this module declares. */
interface CollectionScope {
  libraryID: number;
  collectionKey: string;
}

/**
 * Live item ids filed anywhere under the named collection, as a scalar
 * subquery. A recursive CTE walks `parentCollectionID` down from the collection
 * the key names, skipping trashed collections at every level — Zotero hides
 * those from the collection tree, so their contents are out of scope even when
 * a live subcollection was reparented under one. Trashed items are dropped here
 * rather than at each call site, so `parentItemID` lookups against this set also
 * exclude the children of a trashed item.
 *
 * Only top-level items appear in `collectionItems`; Zotero cannot file a child
 * item in a collection.
 */
function collectionScopeItemIDs(
  placeholder: ParamsPlaceholder<CollectionScope>,
): SQL {
  return sql`(
    with recursive zt_subtree(collectionID) as (
      select ${collections.collectionID} from ${collections}
        where ${collections.libraryID} = ${placeholder("libraryID")}
          and ${collections.key} = ${placeholder("collectionKey")}
          and ${collections.collectionID} not in (select dc.collectionID from ${deletedCollections} dc)
      union
      select child.collectionID from ${collections} child
        join zt_subtree parent on child.parentCollectionID = parent.collectionID
        where child.collectionID not in (select dc.collectionID from ${deletedCollections} dc)
    )
    select ${collectionItems.itemID} from ${collectionItems}
      join zt_subtree on ${collectionItems.collectionID} = zt_subtree.collectionID
      where ${collectionItems.itemID} not in (select di.itemID from ${deletedItems} di)
  )`;
}

const collectionIDByKeyQuery = defineQuery<CollectionScope>()(
  (db, { placeholder }) =>
    db.query.collections.findMany({
      where: {
        libraryID: placeholder("libraryID"),
        key: placeholder("collectionKey"),
        deletedCollection: false,
      },
      columns: { collectionID: true },
      limit: 1,
    }),
);

/**
 * Resolve a collection key against one library, so a caller can tell a stale
 * link apart from an empty collection. A trashed collection reads as absent.
 */
export function getCollectionIDByKey(
  db: NodeDatabaseClient,
  scope: CollectionScope,
): number | undefined {
  return collectionIDByKeyQuery.prepared(db).all(scope)[0]?.collectionID;
}

const indexedItemIDsByCollectionQuery = defineQuery<CollectionScope>()(
  (db, { placeholder }) =>
    db
      .select({ itemID: items.itemID })
      .from(items)
      .innerJoin(itemTypes, eq(itemTypes.itemTypeID, items.itemTypeID))
      .where(
        and(
          sql`${items.itemID} in ${collectionScopeItemIDs(placeholder)}`,
          notInArray(itemTypes.typeName, [...CHILD_ITEM_TYPES]),
        ),
      )
      .orderBy(desc(items.dateModified)),
);

/**
 * The collection-scoped counterpart of {@link getIndexedItemIDsByLibrary}:
 * ordered (dateModified desc) ids of the regular items filed under a collection
 * and its descendants. An unknown key yields an empty list.
 */
export function getIndexedItemIDsByCollection(
  db: NodeDatabaseClient,
  scope: CollectionScope,
): number[] {
  return indexedItemIDsByCollectionQuery
    .prepared(db)
    .all(scope)
    .map((row) => row.itemID);
}

const noteItemIDsByCollectionQuery = defineQuery<CollectionScope>()(
  (db, { placeholder }) =>
    db
      .select({ itemID: itemNotes.itemID })
      .from(itemNotes)
      .leftJoin(deletedItems, eq(deletedItems.itemID, itemNotes.itemID))
      .where(
        and(
          isNull(deletedItems.itemID),
          // A standalone note is filed in the collection itself; a child note
          // rides along with its parent item.
          sql`coalesce(${itemNotes.parentItemID}, ${itemNotes.itemID}) in ${collectionScopeItemIDs(placeholder)}`,
        ),
      )
      .orderBy(asc(itemNotes.itemID)),
);

/**
 * Ids of every live note under a collection and its descendants — standalone
 * notes filed there plus the child notes of the regular items filed there. An
 * unknown key yields an empty list.
 */
export function getNoteItemIDsByCollection(
  db: NodeDatabaseClient,
  scope: CollectionScope,
): number[] {
  return noteItemIDsByCollectionQuery
    .prepared(db)
    .all(scope)
    .map((row) => row.itemID);
}

const noteItemIDsByLibraryQuery = defineQuery<{ libraryID: number }>()(
  (db, { placeholder }) =>
    db
      .select({ itemID: itemNotes.itemID })
      .from(itemNotes)
      .innerJoin(items, eq(items.itemID, itemNotes.itemID))
      .leftJoin(deletedItems, eq(deletedItems.itemID, itemNotes.itemID))
      .where(
        and(
          eq(items.libraryID, placeholder("libraryID")),
          isNull(deletedItems.itemID),
          sql`(${itemNotes.parentItemID} is null or ${itemNotes.parentItemID} not in (select di.itemID from ${deletedItems} di))`,
        ),
      )
      .orderBy(asc(itemNotes.itemID)),
);

/**
 * Ids of every live note in a library, whether standalone or hanging off an
 * item, and whether or not it is filed in a collection. A note whose parent
 * item sits in the trash is excluded along with it.
 */
export function getNoteItemIDsByLibrary(
  db: NodeDatabaseClient,
  libraryID: number,
): number[] {
  return noteItemIDsByLibraryQuery
    .prepared(db)
    .all({ libraryID })
    .map((row) => row.itemID);
}
