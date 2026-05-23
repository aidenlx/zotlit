import {
  creatorTypes,
  deletedItems,
  itemTypeCreatorTypes,
  itemTypes,
} from "@drizzle/schema";
import { sql } from "drizzle-orm";

import { type Temporal } from "@zotlit/shared/temporal";
import { type ItemFields } from "@zotlit/zotero-types";

import { type NodeDatabaseClient } from "@/client/node";
import { type SQLocalDatabaseClient } from "@/client/web";

import { groupQueryBuilder, type GroupQueryParam } from "./_groups";
import { cachedPrepared } from "./_prepared";
import { CHILD_ITEM_TYPES, defineQuery, type QueryRow } from "./_shared";

export interface Creator {
  firstName: string | null;
  lastName: string | null;
  creatorType: string;
  /** 0 = fullName (firstName + lastName), 1 = nameOnly (lastName only). */
  fieldMode: number;
}

export interface BaseItem {
  itemID: number;
  libraryID: number;
  key: string;
  /** `key` or `key + 'g' + groupID`, precomputed for NoteIndex lookup. */
  indexedKey: string;
  /** UTC instant from Zotero's `dateModified` text column. */
  dateModified: Temporal.Instant;
  creators: Creator[];
  /**
   * Creator-type name that Zotero treats as primary for this item type
   * (e.g. `author` for journalArticle/book, `interviewer` for interview,
   * `podcaster` for podcast).
   */
  primaryCreatorType: string | null;
  /**
   * User-defined custom fields (`fieldsCombined.custom = 1`). Built-in fields
   * are assigned as direct item properties, including built-ins newer than the
   * generated schema snapshot.
   */
  fields: ReadonlyMap<string, string | null>;
}

export type Item = BaseItem & ItemFields;

export type ItemOfType<T extends ItemFields["itemType"]> = Extract<
  Item,
  { itemType: T }
>;

export function formatIndexedKey(
  key: string,
  groupID: number | null | undefined,
): string {
  return groupID == null ? key : `${key}g${groupID}`;
}

type ItemQueryParam = {
  libraryID: number;
};

type ItemFilter = {
  /** Inline `WHERE itemID IN (...)` clause; omit for the full library scan. */
  itemIDs?: readonly number[];
};

const itemQueryBuilder = defineQuery((db, { itemIDs }: ItemFilter = {}) =>
  db.query.items.findMany({
    where: {
      AND: [
        { libraryID: sql.placeholder("libraryID") },
        {
          RAW: (t, { notInArray, inArray }) =>
            notInArray(
              t.itemTypeID,
              db
                .select({ itemTypeID: itemTypes.itemTypeID })
                .from(itemTypes)
                .where(inArray(itemTypes.typeName, [...CHILD_ITEM_TYPES])),
            ),
        },
        {
          RAW: (t, { notExists, eq }) =>
            notExists(
              db
                .select()
                .from(deletedItems)
                .where(eq(deletedItems.itemID, t.itemID)),
            ),
        },
        ...(itemIDs ? [{ itemID: { in: [...itemIDs] } }] : []),
      ],
    },
    columns: {
      itemID: true,
      libraryID: true,
      key: true,
      dateModified: true,
      itemTypeID: true,
    },
    extras: {
      itemType: (t) => sql<string>`
SELECT ${itemTypes.typeName}
FROM ${itemTypes}
WHERE ${itemTypes.itemTypeID} = ${t.itemTypeID}
LIMIT 1`,
      primaryCreatorType: (t) => sql<string | null>`
SELECT ${creatorTypes.creatorType}
FROM ${itemTypeCreatorTypes}
INNER JOIN ${creatorTypes}
  ON ${creatorTypes.creatorTypeID} = ${itemTypeCreatorTypes.creatorTypeID}
WHERE ${itemTypeCreatorTypes.itemTypeID} = ${t.itemTypeID}
  AND ${itemTypeCreatorTypes.primaryField} = 1
LIMIT 1`,
    },
    with: {
      itemData: {
        columns: {},
        with: {
          fieldsCombined: { columns: { fieldName: true, custom: true } },
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
    orderBy: { dateModified: "desc" },
  }),
);

type ItemRow = QueryRow<typeof itemQueryBuilder>;

function toItem(row: ItemRow, groupID: number | null): Item {
  const namedProps: Record<string, string | null> = {};
  const customFields = new Map<string, string | null>();
  for (const d of row.itemData) {
    if (!d.fieldsCombined) continue;
    const name = d.fieldsCombined.fieldName;
    const value = d.itemDataValue?.value ?? null;
    if (d.fieldsCombined.custom === 1) {
      customFields.set(name, value);
    } else {
      namedProps[name] = value;
    }
  }
  const creators: Creator[] = row.itemCreators.map((ic) => ({
    firstName: ic.creator?.firstName ?? null,
    lastName: ic.creator?.lastName ?? null,
    creatorType: ic.creatorType?.creatorType ?? "",
    fieldMode: ic.creator?.fieldMode ?? 0,
  }));
  return {
    itemID: row.itemID,
    libraryID: row.libraryID,
    key: row.key,
    indexedKey: formatIndexedKey(row.key, groupID),
    dateModified: row.dateModified,
    creators,
    primaryCreatorType: row.primaryCreatorType,
    fields: customFields,
    itemType: row.itemType,
    ...namedProps,
  } as Item;
}

export function getItemsByLibrary(
  db: NodeDatabaseClient,
  libraryID: number,
): Item[] {
  const queryParam = { libraryID } satisfies ItemQueryParam;
  const groupId =
    cachedPrepared(db, "groups", (d) => groupQueryBuilder(d).prepare()).all(
      queryParam,
    )[0]?.groupID ?? null;
  return cachedPrepared(db, "items", (d) => itemQueryBuilder(d).prepare())
    .all(queryParam)
    .map((r) => toItem(r, groupId));
}

export async function getItemsByLibraryAsync(
  db: SQLocalDatabaseClient,
  libraryID: number,
): Promise<Item[]> {
  const rows = await itemQueryBuilder(db)
    .prepare()
    .all({ libraryID } satisfies ItemQueryParam);
  const [group] = await groupQueryBuilder(db)
    .prepare()
    .all({ libraryID } satisfies GroupQueryParam);
  const groupId = group?.groupID ?? null;
  return rows.map((r) => toItem(r, groupId));
}

export function getItemsByID(
  db: NodeDatabaseClient,
  libraryID: number,
  itemIDs: readonly number[],
): Map<number, Item> {
  if (itemIDs.length === 0) return new Map();

  const queryParam = { libraryID } satisfies ItemQueryParam;
  const groupId =
    cachedPrepared(db, "groups", (d) => groupQueryBuilder(d).prepare()).get(
      queryParam,
    )?.groupID ?? null;
  // IDs inline into SQL, so the statement isn't cacheable per-call.
  const rows = itemQueryBuilder(db, { itemIDs }).prepare().all(queryParam);
  return toItemMap(rows, groupId);
}

export async function getItemsByIDAsync(
  db: SQLocalDatabaseClient,
  libraryID: number,
  itemIDs: readonly number[],
): Promise<Map<number, Item>> {
  if (itemIDs.length === 0) return new Map();

  const queryParam = { libraryID } satisfies ItemQueryParam;
  const [rows, [group]] = await Promise.all([
    itemQueryBuilder(db, { itemIDs }).prepare().all(queryParam),
    groupQueryBuilder(db).prepare().all(queryParam),
  ]);
  return toItemMap(rows, group?.groupID ?? null);
}

function toItemMap(
  rows: readonly ItemRow[],
  groupID: number | null,
): Map<number, Item> {
  return new Map(rows.map((row) => [row.itemID, toItem(row, groupID)]));
}
