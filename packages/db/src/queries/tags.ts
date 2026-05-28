import { type NodeDatabaseClient } from "@/client/node";
import { type SQLocalDatabaseClient } from "@/client/web";

import { defineQuery, type QueryRow } from "./_shared";

export interface Tag {
  itemID: number;
  tagID: number;
  name: string;
  /** Per-item tag application type: 0 = manual, 1 = automatic. */
  type: number;
}

const tagsByItemQuery = defineQuery<{
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
    columns: { itemID: true, type: true },
    with: {
      tag: { columns: { tagID: true, name: true } },
    },
  }),
);

type TagRow = QueryRow<typeof tagsByItemQuery>;

function toTag(row: TagRow): Tag {
  return {
    itemID: row.itemID,
    tagID: row.tag.tagID,
    name: row.tag.name,
    type: row.type,
  };
}

const byName = (a: Tag, b: Tag): number => a.name.localeCompare(b.name);

export function getTagsByItemIDs(
  db: NodeDatabaseClient,
  itemIDs: readonly number[],
  libraryID: number,
): Tag[] {
  const stmt = tagsByItemQuery.prepared(db);
  return itemIDs.flatMap((itemID) =>
    stmt.all({ itemID, libraryID }).map(toTag).toSorted(byName),
  );
}

export async function getTagsByItemIDsAsync(
  db: SQLocalDatabaseClient,
  itemIDs: readonly number[],
  libraryID: number,
): Promise<Tag[]> {
  const stmt = tagsByItemQuery.prepared(db);
  const batches = await Promise.all(
    itemIDs.map((itemID) => stmt.all({ itemID, libraryID })),
  );
  return batches.flatMap((rows) => rows.map(toTag).toSorted(byName));
}
