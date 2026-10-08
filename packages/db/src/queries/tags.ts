import { distinct } from "@std/collections";

import type { NodeDatabaseClient } from "@/client/node";
import type { ItemTag, Tag } from "@/lib/zt-tag";

import { defineQuery, defineKeyedQuery } from "./_shared";
import type { FindManyOptions } from "./_shared";

const itemTagOptions = {
  columns: { itemID: true, tagID: true, type: true },
  with: { tag: { columns: { tagID: true, name: true } } },
} satisfies FindManyOptions<"itemTags">;

const itemTagsByItemsQuery = defineKeyedQuery<number>()(
  (db, { contains }) =>
    db.query.itemTags.findMany({
      where: {
        RAW: (itemTag) => contains(itemTag.itemID),
        item: { deletedItem: false },
      },
      ...itemTagOptions,
    }),
  {
    keyOf: (row) => row.itemID,
    orderWithinKey: (a, b) => tagName(a).localeCompare(tagName(b)),
  },
);

function tagName(row: { tagID: number; tag: Tag | null }): string {
  if (!row.tag) {
    throw new Error(`Missing tag row for tagID ${row.tagID}`);
  }
  return row.tag.name;
}

/**
 * Tag applications of each item, in `itemIDs` order and in tag-name order
 * within one item, through one cached keyed read. An item with no tag adds
 * nothing; a repeated id repeats its tags. Items that share a tag share one
 * {@link Tag} object.
 */
export function getTagsByItemIDs(
  db: NodeDatabaseClient,
  itemIDs: readonly number[],
): ItemTag[] {
  const rows = itemTagsByItemsQuery(db, itemIDs);
  const tagsByID = new Map<number, Tag>();
  return rows.map((row) => {
    const tag = tagsByID.get(row.tagID) ?? {
      tagID: row.tagID,
      name: tagName(row),
    };
    tagsByID.set(row.tagID, tag);
    return { itemID: row.itemID, tag, type: row.type };
  });
}

/**
 * Per-batch memo of an item's tag applications, keyed by itemID. Hold one across
 * a batch (like a `GroupIDMemo`) so repeat lookups for the same itemID skip the
 * query; discard per single op.
 */
export type TagMemo = Map<number, readonly ItemTag[]>;

/** Resolve one item's tags, memoized per itemID within `memo`. */
export function resolveItemTags(
  db: NodeDatabaseClient,
  itemID: number,
  memo: TagMemo,
): readonly ItemTag[] {
  return resolveItemTagsByIDs(db, [itemID], memo).get(itemID) ?? [];
}

/** Resolve each item's tags keyed by itemID, filling `memo`. */
export function resolveItemTagsByIDs(
  db: NodeDatabaseClient,
  itemIDs: readonly number[],
  memo: TagMemo,
): ReadonlyMap<number, readonly ItemTag[]> {
  const result = new Map<number, readonly ItemTag[]>();
  const missing: number[] = [];
  for (const itemID of itemIDs) {
    const cached = memo.get(itemID);
    if (cached) {
      result.set(itemID, cached);
    } else {
      missing.push(itemID);
    }
  }
  if (missing.length > 0) {
    const tagsByItemID = Map.groupBy(
      getTagsByItemIDs(db, missing),
      (tag) => tag.itemID,
    );
    for (const itemID of missing) {
      const tags = tagsByItemID.get(itemID) ?? [];
      memo.set(itemID, tags);
      result.set(itemID, tags);
    }
  }
  return result;
}

const allTagNamesQuery = defineQuery<void>()((db) =>
  db.query.tags.findMany({ columns: { name: true } }),
);

/**
 * Every Tag name across the database, each name once, in name order. A name
 * counts while the `tags` table holds it, whether or not an item carries it.
 */
export function getAllTagNames(db: NodeDatabaseClient): string[] {
  return distinct(
    allTagNamesQuery
      .prepared(db)
      .all()
      .map((row) => row.name),
  ).toSorted((a, b) => a.localeCompare(b));
}

const libraryTagNamesQuery = defineQuery<{ libraryID: number }>()(
  (db, { placeholder }) =>
    db.query.itemTags.findMany({
      where: {
        item: { libraryID: placeholder("libraryID"), deletedItem: false },
      },
      columns: {},
      with: { tag: { columns: { name: true } } },
    }),
);

/**
 * Every Tag name in use on one Library's items, each name once, in name order.
 * Zotero's `tags` table holds no library, so a name counts for a Library only
 * while an item there carries it.
 */
export function getLibraryTagNames(
  db: NodeDatabaseClient,
  libraryID: number,
): string[] {
  return distinct(
    libraryTagNamesQuery
      .prepared(db)
      .all({ libraryID })
      .map((row) => row.tag.name),
  ).toSorted((a, b) => a.localeCompare(b));
}
