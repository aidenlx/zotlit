import { distinct } from "@std/collections";

import { type NodeDatabaseClient } from "@/client/node";
import { type ItemTag, type Tag } from "@/lib/zt-tag";

import { defineQuery, type QueryRow } from "./_shared";

const itemTagsByItemQuery = defineQuery<{ itemID: number }>()(
  (db, { placeholder }) =>
    db.query.itemTags.findMany({
      where: {
        itemID: placeholder("itemID"),
        item: { deletedItem: false },
      },
      columns: { itemID: true, tagID: true, type: true },
    }),
);

const tagByIdQuery = defineQuery<{ tagID: number }>()((db, { placeholder }) =>
  db.query.tags.findMany({
    where: { tagID: placeholder("tagID") },
    columns: { tagID: true, name: true },
  }),
);

type ItemTagRow = QueryRow<typeof itemTagsByItemQuery>;
type TagRow = QueryRow<typeof tagByIdQuery>;

function toTag(row: TagRow): Tag {
  return {
    tagID: row.tagID,
    name: row.name,
  };
}

function toItemTag(
  row: ItemTagRow,
  tagsByID: ReadonlyMap<number, Tag>,
): ItemTag {
  const tag = tagsByID.get(row.tagID);
  if (!tag) {
    throw new Error(`Missing tag row for tagID ${row.tagID}`);
  }
  return { itemID: row.itemID, tag, type: row.type };
}

const byTagName = (a: ItemTag, b: ItemTag): number =>
  a.tag.name.localeCompare(b.tag.name);

export function getTagsByItemIDs(
  db: NodeDatabaseClient,
  itemIDs: readonly number[],
): ItemTag[] {
  const batches = itemIDs.map((itemID) =>
    itemTagsByItemQuery.prepared(db).all({ itemID }),
  );
  const rows = batches.flat();
  const tagsByID = new Map(
    distinct(rows.map((row) => row.tagID))
      .map((tagID) => tagByIdQuery.prepared(db).all({ tagID })[0])
      .filter((row): row is TagRow => row != null)
      .map((row) => [row.tagID, toTag(row)]),
  );
  return batches.flatMap((rows) =>
    rows.map((row) => toItemTag(row, tagsByID)).toSorted(byTagName),
  );
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
