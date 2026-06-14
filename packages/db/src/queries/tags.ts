import { type NodeDatabaseClient } from "@/client/node";
import { type SQLocalDatabaseClient } from "@/client/web";
import { type ItemTag, type Tag } from "@/lib/zt-tag";

import { defineQuery, type QueryRow } from "./_shared";

const itemTagsByItemQuery = defineQuery<{
  itemID: number;
  libraryID: number;
}>()((db, { placeholder }) =>
  db.query.itemTags.findMany({
    where: {
      itemID: placeholder("itemID"),
      item: {
        libraryID: placeholder("libraryID"),
        deletedItem: false,
      },
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
  return {
    itemID: row.itemID,
    tag,
    type: row.type,
  };
}

const byTagName = (a: ItemTag, b: ItemTag): number =>
  a.tag.name.localeCompare(b.tag.name);

export function getTagsByItemIDs(
  db: NodeDatabaseClient,
  itemIDs: readonly number[],
  libraryID: number,
): ItemTag[] {
  const batches = itemIDs.map((itemID) =>
    itemTagsByItemQuery.prepared(db).all({ itemID, libraryID }),
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

export async function getTagsByItemIDsAsync(
  db: SQLocalDatabaseClient,
  itemIDs: readonly number[],
  libraryID: number,
): Promise<ItemTag[]> {
  const batches = await Promise.all(
    itemIDs.map((itemID) =>
      itemTagsByItemQuery.prepared(db).all({ itemID, libraryID }),
    ),
  );
  const rows = batches.flat();
  const tagRows = await Promise.all(
    distinct(rows.map((row) => row.tagID)).map((tagID) =>
      tagByIdQuery.prepared(db).all({ tagID }),
    ),
  );
  const tagsByID = new Map(
    tagRows.flatMap(([row]): [number, Tag][] =>
      row ? [[row.tagID, toTag(row)]] : [],
    ),
  );
  return batches.flatMap((rows) =>
    rows.map((row) => toItemTag(row, tagsByID)).toSorted(byTagName),
  );
}

function distinct<T>(array: readonly T[]): T[] {
  return [...new Set(array)];
}
