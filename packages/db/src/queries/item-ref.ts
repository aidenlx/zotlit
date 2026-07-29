import { type NodeDatabaseClient } from "@/client/node";
import { formatIndexedKey } from "@/lib/zt-key";

import { groupIDForLibrary, resolveGroupID, type GroupIDMemo } from "./_groups";
import { defineQuery } from "./_shared";
import { type Item } from "./items";

/**
 * A Zotero item resolved to its key + owning library, library-scope-free — the
 * locate-the-note subset of {@link Item}, without the hydrated fields/creators.
 */
export type ItemRef = Pick<
  Item,
  "itemID" | "libraryID" | "key" | "groupID" | "indexedKey"
>;

const itemRefByIdQuery = defineQuery<{ itemID: number }>()(
  (db, { placeholder }) =>
    db.query.items.findMany({
      columns: { key: true, libraryID: true },
      where: { itemID: placeholder("itemID"), deletedItem: false },
      limit: 1,
    }),
);

/**
 * Resolve a Zotero item to its key + owning library by global item id, with no
 * caller-supplied library scope. Item ids are unique across libraries, so the
 * Zotero reader's `itemID` (which travels without a library) maps cleanly here.
 *
 * @returns the {@link ItemRef}, or `null` when no live item has that id.
 */
export function getItemRefByID(
  db: NodeDatabaseClient,
  itemID: number,
): ItemRef | null {
  const row = itemRefByIdQuery.prepared(db).all({ itemID })[0];
  if (!row) return null;
  const groupID = groupIDForLibrary(db, row.libraryID);
  return {
    itemID,
    key: row.key,
    libraryID: row.libraryID,
    groupID,
    indexedKey: formatIndexedKey(row.key, groupID),
  };
}

/** An {@link ItemRef} plus the item's title — a lightweight display label
 * without the heavy `getItemsByID` relational load. */
export interface ItemDisplayRef extends ItemRef {
  /** The item's `title` field, or `null` when unset. */
  title: string | null;
}

const itemDisplayRefByIdQuery = defineQuery<{ itemID: number }>()(
  (db, { placeholder }) =>
    db.query.items.findMany({
      columns: { key: true, libraryID: true },
      where: { itemID: placeholder("itemID"), deletedItem: false },
      with: {
        itemData: {
          columns: {},
          with: {
            fieldsCombined: {
              columns: { fieldName: true },
              where: { fieldName: { eq: "title" } },
            },
            itemDataValue: { columns: { value: true } },
          },
        },
      },
      limit: 1,
    }),
);

/**
 * Resolve an item to its {@link ItemRef} plus title by global item id in one
 * lightweight query — enough to classify a batch (indexed key → existing note)
 * and label each row, without the heavy `getItemsByID` relational load.
 *
 * @param opts.memo caller-owned `libraryID → groupID` cache. Pass a shared memo
 *   to resolve each library once across the per-id calls of a batch classify
 *   loop; omit to scope the cache to this call.
 * @returns the {@link ItemDisplayRef}, or `null` when no live item has that id.
 */
export function getItemDisplayRefByID(
  db: NodeDatabaseClient,
  itemID: number,
  opts?: { memo?: GroupIDMemo },
): ItemDisplayRef | null {
  const row = itemDisplayRefByIdQuery.prepared(db).all({ itemID })[0];
  if (!row) return null;
  const groupID = opts?.memo
    ? resolveGroupID(db, row.libraryID, opts.memo)
    : groupIDForLibrary(db, row.libraryID);
  const title =
    row.itemData.find((d) => d.fieldsCombined?.fieldName === "title")
      ?.itemDataValue?.value ?? null;
  return {
    itemID,
    key: row.key,
    libraryID: row.libraryID,
    groupID,
    indexedKey: formatIndexedKey(row.key, groupID),
    title,
  };
}

export type ItemDisplayInfo = Pick<
  Item,
  "key" | "creators" | "primaryCreatorType"
> & {
  fields: {
    title: string | null;
    citationKey: string | null;
    date: string | null;
  };
};

const itemDisplayInfoQuery = defineQuery<{ itemID: number }>()(
  (db, { placeholder }) =>
    db.query.items.findMany({
      columns: { key: true },
      where: { itemID: placeholder("itemID"), deletedItem: false },
      with: {
        itemType: {
          columns: {},
          with: {
            itemTypeCreatorTypes: {
              columns: {},
              where: { primaryField: { eq: 1 } },
              limit: 1,
              with: {
                creatorType: { columns: { creatorType: true } },
              },
            },
          },
        },
        itemData: {
          columns: {},
          with: {
            fieldsCombined: {
              columns: { fieldName: true },
              where: { fieldName: { in: ["title", "citationKey", "date"] } },
            },
            itemDataValue: { columns: { value: true } },
          },
        },
        itemCreators: {
          columns: {},
          orderBy: { orderIndex: "asc" },
          with: {
            creator: {
              columns: {
                firstName: true,
                lastName: true,
                fieldMode: true,
              },
            },
            creatorType: { columns: { creatorType: true } },
          },
        },
      },
      limit: 1,
    }),
);

export function getItemDisplayInfoByID(
  db: NodeDatabaseClient,
  itemID: number,
): ItemDisplayInfo | null {
  const row = itemDisplayInfoQuery.prepared(db).all({ itemID })[0];
  if (!row) return null;

  let title: string | null = null;
  let citationKey: string | null = null;
  let date: string | null = null;
  for (const data of row.itemData) {
    if (data.fieldsCombined?.fieldName === "title") {
      title = data.itemDataValue?.value ?? null;
    } else if (data.fieldsCombined?.fieldName === "citationKey") {
      citationKey = data.itemDataValue?.value ?? null;
    } else if (data.fieldsCombined?.fieldName === "date") {
      date = data.itemDataValue?.value ?? null;
    }
  }

  return {
    key: row.key,
    fields: { title, citationKey, date },
    creators: row.itemCreators.map((itemCreator) => ({
      firstName: itemCreator.creator?.firstName ?? null,
      lastName: itemCreator.creator?.lastName ?? null,
      creatorType: itemCreator.creatorType?.creatorType ?? "",
      fieldMode: itemCreator.creator?.fieldMode ?? 0,
    })),
    primaryCreatorType:
      row.itemType.itemTypeCreatorTypes[0]?.creatorType?.creatorType ?? null,
  };
}
