import { type NodeDatabaseClient } from "@/client/node";
import { type CreatorFieldMode } from "@/lib/zt-creator";
import { parseItemDate } from "@/lib/zt-date";
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

/** Lightweight display fields for the annotation view's item identity label. */
export interface ItemDisplayInfo {
  title: string | null;
  creators: {
    firstName: string | null;
    lastName: string | null;
    fieldMode: CreatorFieldMode;
  }[];
  year: number | null;
}

const itemDisplayInfoQuery = defineQuery<{ itemID: number }>()(
  (db, { placeholder }) =>
    db.query.items.findMany({
      columns: {},
      where: { itemID: placeholder("itemID"), deletedItem: false },
      with: {
        itemData: {
          columns: {},
          with: {
            fieldsCombined: {
              columns: { fieldName: true },
              where: { fieldName: { in: ["title", "date"] } },
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
          },
        },
      },
      limit: 1,
    }),
);

/**
 * Fetch title, creators, and year for a single item by global item id.
 * Used by the annotation view to build the item identity label.
 */
export function getItemDisplayInfoByID(
  db: NodeDatabaseClient,
  itemID: number,
): ItemDisplayInfo | null {
  const row = itemDisplayInfoQuery.prepared(db).all({ itemID })[0];
  if (!row) return null;

  let title: string | null = null;
  let dateRaw: string | null = null;
  for (const d of row.itemData) {
    if (!d.fieldsCombined) continue;
    if (d.fieldsCombined.fieldName === "title") {
      title = d.itemDataValue?.value ?? null;
    } else if (d.fieldsCombined.fieldName === "date") {
      dateRaw = d.itemDataValue?.value ?? null;
    }
  }

  const creators = row.itemCreators.map((ic) => ({
    firstName: ic.creator?.firstName ?? null,
    lastName: ic.creator?.lastName ?? null,
    fieldMode: (ic.creator?.fieldMode ?? 0) as CreatorFieldMode,
  }));

  return {
    title,
    creators,
    year: parseItemDate(dateRaw)?.year ?? null,
  };
}
