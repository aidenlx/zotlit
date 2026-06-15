import { type Temporal } from "@zotlit/shared/temporal";
import { type ItemFields } from "@zotlit/zotero-types";

import { type NodeDatabaseClient } from "@/client/node";
import { type SQLocalDatabaseClient } from "@/client/web";
import { type CreatorFieldMode } from "@/lib/zt-creator";

import { groupsQuery } from "./_groups";
import {
  CHILD_ITEM_TYPES,
  defineQuery,
  type FindManyOptions,
  type QueryRow,
} from "./_shared";

export interface Creator {
  firstName: string | null;
  lastName: string | null;
  creatorType: string;
  fieldMode: CreatorFieldMode;
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

const itemFindOptions = {
  columns: {
    itemID: true,
    libraryID: true,
    key: true,
    dateModified: true,
  },
  with: {
    itemType: {
      columns: { typeName: true },
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
} satisfies FindManyOptions<"items">;

const itemsByLibraryQuery = defineQuery<{ libraryID: number }>()(
  (db, { placeholder }) =>
    db.query.items.findMany({
      where: {
        libraryID: placeholder("libraryID"),
        itemType: { typeName: { notIn: [...CHILD_ITEM_TYPES] } },
        deletedItem: false,
      },
      ...itemFindOptions,
      orderBy: { dateModified: "desc" },
    }),
);

const itemByIdQuery = defineQuery<{ libraryID: number; itemID: number }>()(
  (db, { placeholder }) =>
    db.query.items.findMany({
      where: {
        libraryID: placeholder("libraryID"),
        itemID: placeholder("itemID"),
        itemType: { typeName: { notIn: [...CHILD_ITEM_TYPES] } },
        deletedItem: false,
      },
      ...itemFindOptions,
    }),
);

const itemByKeyQuery = defineQuery<{ libraryID: number; key: string }>()(
  (db, { placeholder }) =>
    db.query.items.findMany({
      where: {
        libraryID: placeholder("libraryID"),
        key: placeholder("key"),
        itemType: { typeName: { notIn: [...CHILD_ITEM_TYPES] } },
        deletedItem: false,
      },
      ...itemFindOptions,
    }),
);

type ItemRow = QueryRow<typeof itemsByLibraryQuery>;

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
  const primaryCreatorType =
    row.itemType.itemTypeCreatorTypes[0]?.creatorType?.creatorType ?? null;
  return {
    itemID: row.itemID,
    libraryID: row.libraryID,
    key: row.key,
    indexedKey: formatIndexedKey(row.key, groupID),
    dateModified: row.dateModified,
    creators,
    primaryCreatorType,
    fields: customFields,
    itemType: row.itemType.typeName,
    ...namedProps,
  } as Item;
}

export function getItemsByLibrary(
  db: NodeDatabaseClient,
  libraryID: number,
): Item[] {
  const groupId =
    groupsQuery.prepared(db).all({ libraryID })[0]?.groupID ?? null;
  return itemsByLibraryQuery
    .prepared(db)
    .all({ libraryID })
    .map((r) => toItem(r, groupId));
}

export async function getItemsByLibraryAsync(
  db: SQLocalDatabaseClient,
  libraryID: number,
): Promise<Item[]> {
  const [rows, [group]] = await Promise.all([
    itemsByLibraryQuery.prepared(db).all({ libraryID }),
    groupsQuery.prepared(db).all({ libraryID }),
  ]);
  return rows.map((r) => toItem(r, group?.groupID ?? null));
}

export function getItemsByID(
  db: NodeDatabaseClient,
  libraryID: number,
  itemIDs: readonly number[],
): Item[] {
  if (itemIDs.length === 0) return [];

  const groupId = groupsQuery.prepared(db).get({ libraryID })?.groupID ?? null;
  const stmt = itemByIdQuery.prepared(db);
  return itemIDs.flatMap((itemID) =>
    stmt.all({ libraryID, itemID }).map((r) => toItem(r, groupId)),
  );
}

export async function getItemsByIDAsync(
  db: SQLocalDatabaseClient,
  libraryID: number,
  itemIDs: readonly number[],
): Promise<Item[]> {
  if (itemIDs.length === 0) return [];

  const stmt = itemByIdQuery.prepared(db);
  const [batches, [group]] = await Promise.all([
    Promise.all(itemIDs.map((itemID) => stmt.all({ libraryID, itemID }))),
    groupsQuery.prepared(db).all({ libraryID }),
  ]);
  const groupId = group?.groupID ?? null;
  return batches.flat().map((r) => toItem(r, groupId));
}

export function getItemsByKey(
  db: NodeDatabaseClient,
  libraryID: number,
  keys: readonly string[],
): Item[] {
  if (keys.length === 0) return [];

  const groupId = groupsQuery.prepared(db).get({ libraryID })?.groupID ?? null;
  const stmt = itemByKeyQuery.prepared(db);
  return keys.flatMap((key) =>
    stmt.all({ libraryID, key }).map((r) => toItem(r, groupId)),
  );
}

export async function getItemsByKeyAsync(
  db: SQLocalDatabaseClient,
  libraryID: number,
  keys: readonly string[],
): Promise<Item[]> {
  if (keys.length === 0) return [];

  const stmt = itemByKeyQuery.prepared(db);
  const [batches, [group]] = await Promise.all([
    Promise.all(keys.map((key) => stmt.all({ libraryID, key }))),
    groupsQuery.prepared(db).all({ libraryID }),
  ]);
  const groupId = group?.groupID ?? null;
  return batches.flat().map((r) => toItem(r, groupId));
}
