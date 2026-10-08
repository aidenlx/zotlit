import type { ItemFields } from "@zotlit/zotero-types";

import type { NodeDatabaseClient } from "@/client/node";
import type { SQLocalDatabaseClient } from "@/client/web";
import type { CreatorFieldMode } from "@/lib/zt-creator";
import { formatIndexedKey } from "@/lib/zt-key";
import {
  EMPTY_ITEM_BASE_FIELDS,
  ITEM_BASE_FIELDS,
  resolveVenue,
} from "@/lib/zt-venue";
import type { ItemBaseFieldName, ItemBaseFields } from "@/lib/zt-venue";

import { getBaseFieldTable, getBaseFieldTableAsync } from "./_base-fields";
import type { BaseFieldTable } from "./_base-fields";
import { groupIDForLibrary, groupsQuery, resolveGroupID } from "./_groups";
import type { GroupIDMemo } from "./_groups";
import { CHILD_ITEM_TYPES, defineQuery, idSlots, rowsByID } from "./_shared";
import type {
  ChildItemType,
  FindManyOptions,
  QueryRow,
  SlotParams,
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
  /** UTC instant from Zotero's `dateAdded` text column. */
  dateAdded: Temporal.Instant;
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
  customFields: ReadonlyMap<string, string | null>;
}

export type Item = BaseItem & {
  fields: ItemFields;
  /**
   * The same stored values as {@link Item.fields}, read under their canonical
   * Zotero base-field names, so a caller asks one question of every item type
   * (`bookSection.bookTitle` and `preprint.repository` both answer here).
   * `fields` stays raw, which leaves the template data contract untouched.
   */
  baseFields: ItemBaseFields;
  /**
   * The **Venue** derived from {@link Item.baseFields} — the journal, book,
   * website, repository, university, or publisher the item appeared under.
   */
  venue: string | null;
  /** `groups.groupID` for a group library, `null` for the user library. */
  groupID: number | null;
};

export type ChildItemFields = Extract<
  ItemFields,
  { readonly itemType: ChildItemType }
>;

export function isChildItemFields(
  fields: ItemFields,
): fields is ChildItemFields {
  return CHILD_ITEM_TYPES.some((itemType) => itemType === fields.itemType);
}

const itemFindOptions = {
  columns: {
    itemID: true,
    libraryID: true,
    key: true,
    dateAdded: true,
    dateModified: true,
    itemTypeID: true,
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
        fieldsCombined: {
          columns: { fieldID: true, fieldName: true, custom: true },
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

const itemsByIdsQuery = defineQuery<SlotParams<number>>()(
  (db, { placeholder }) =>
    db.query.items.findMany({
      where: {
        itemID: { in: idSlots(placeholder) },
        itemType: { typeName: { notIn: [...CHILD_ITEM_TYPES] } },
        deletedItem: false,
      },
      ...itemFindOptions,
    }),
);

const itemsByKeysQuery = defineQuery<
  { libraryID: number } & SlotParams<string>
>()((db, { placeholder }) =>
  db.query.items.findMany({
    where: {
      libraryID: placeholder("libraryID"),
      key: { in: idSlots(placeholder) },
      itemType: { typeName: { notIn: [...CHILD_ITEM_TYPES] } },
      deletedItem: false,
    },
    ...itemFindOptions,
  }),
);

const itemTypeByKeyQuery = defineQuery<{
  libraryID: number;
  key: string;
}>()((db, { placeholder }) =>
  db.query.items.findMany({
    columns: {},
    with: { itemType: { columns: { typeName: true } } },
    where: {
      libraryID: placeholder("libraryID"),
      key: placeholder("key"),
      deletedItem: false,
    },
    limit: 1,
  }),
);

type ItemRow = QueryRow<typeof itemsByLibraryQuery>;

function toFields(
  row: Pick<ItemRow, "itemData" | "itemTypeID">,
  baseFieldTable: BaseFieldTable<ItemBaseFieldName>,
) {
  const namedProps: Record<string, string | null> = {};
  const customFields = new Map<string, string | null>();
  const baseFields: Record<ItemBaseFieldName, string | null> = {
    ...EMPTY_ITEM_BASE_FIELDS,
  };
  for (const d of row.itemData) {
    if (!d.fieldsCombined) continue;
    const name = d.fieldsCombined.fieldName;
    const value = d.itemDataValue?.value ?? null;
    if (d.fieldsCombined.custom === 1) {
      customFields.set(name, value);
    } else {
      namedProps[name] = value;
    }
    const baseName = baseFieldTable.resolve(
      row.itemTypeID,
      d.fieldsCombined.fieldID,
    );
    // A null reads the same as an absent field here, so it never displaces a
    // populated one where two stored fields resolve to the same base field.
    if (baseName && value !== null) baseFields[baseName] = value;
  }
  return { namedProps, customFields, baseFields };
}

function toItem(
  row: ItemRow,
  groupID: number | null,
  baseFieldTable: BaseFieldTable<ItemBaseFieldName>,
): Item {
  const { namedProps, customFields, baseFields } = toFields(
    row,
    baseFieldTable,
  );
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
    groupID,
    dateAdded: row.dateAdded,
    dateModified: row.dateModified,
    creators,
    primaryCreatorType,
    customFields,
    fields: { itemType: row.itemType.typeName, ...namedProps } as ItemFields,
    baseFields,
    venue: resolveVenue(baseFields),
  };
}

export function getItemsByLibrary(
  db: NodeDatabaseClient,
  libraryID: number,
): Item[] {
  const groupId = groupIDForLibrary(db, libraryID);
  const baseFieldTable = getBaseFieldTable(db, ITEM_BASE_FIELDS);
  return itemsByLibraryQuery
    .prepared(db)
    .all({ libraryID })
    .map((r) => toItem(r, groupId, baseFieldTable));
}

export async function getItemsByLibraryAsync(
  db: SQLocalDatabaseClient,
  libraryID: number,
): Promise<Item[]> {
  const [rows, [group], baseFieldTable] = await Promise.all([
    itemsByLibraryQuery.prepared(db).all({ libraryID }),
    groupsQuery.prepared(db).all({ libraryID }),
    getBaseFieldTableAsync(db, ITEM_BASE_FIELDS),
  ]);
  return rows.map((r) => toItem(r, group?.groupID ?? null, baseFieldTable));
}

/**
 * Fetch items by global item id, in `itemIDs` order, through {@link rowsByID}:
 * one cached statement per {@link BATCH_SLOTS} distinct ids. An id that names
 * no live regular item has no entry; a repeated id repeats its item. Item ids
 * are unique across libraries, so the batch may span libraries; each row's
 * `groupID`/`indexedKey` resolves from its own `libraryID`.
 *
 * @param opts.memo caller-owned `libraryID → groupID` cache. Pass a shared memo
 *   to resolve each library once across many calls; omit to scope the cache
 *   to this call.
 */
export function getItemsByID(
  db: NodeDatabaseClient,
  itemIDs: readonly number[],
  opts?: { memo?: GroupIDMemo },
): Item[] {
  if (itemIDs.length === 0) return [];

  const memo = opts?.memo ?? new Map();
  const baseFieldTable = getBaseFieldTable(db, ITEM_BASE_FIELDS);
  return rowsByID(itemIDs, {
    batch: (slots) => itemsByIdsQuery.prepared(db).all(slots),
    idOf: (row) => row.itemID,
  }).map((row) =>
    toItem(row, resolveGroupID(db, row.libraryID, memo), baseFieldTable),
  );
}

export function getItemTypeByKey(
  db: NodeDatabaseClient,
  libraryID: number,
  key: string,
): string | null {
  return (
    itemTypeByKeyQuery.prepared(db).all({ libraryID, key })[0]?.itemType
      .typeName ?? null
  );
}

/**
 * Fetch regular items of one library by key, in `keys` order, through
 * {@link rowsByID}: one cached statement per {@link BATCH_SLOTS} distinct keys.
 * A key that names no live regular item has no entry; a repeated key repeats
 * its item.
 *
 * @param opts.memo caller-owned `libraryID → groupID` cache, as in
 *   {@link getItemsByID}. A caller that already knows the library's group
 *   seeds it and saves the group read.
 */
export function getItemsByKey(
  db: NodeDatabaseClient,
  keys: readonly string[],
  opts: { libraryID: number; memo?: GroupIDMemo },
): Item[] {
  if (keys.length === 0) return [];

  const { libraryID } = opts;
  const rows = rowsByID(keys, {
    batch: (slots) =>
      itemsByKeysQuery.prepared(db).all({ libraryID, ...slots }),
    idOf: (row) => row.key,
  });
  if (rows.length === 0) return [];
  const groupId = resolveGroupID(db, libraryID, opts.memo ?? new Map());
  const baseFieldTable = getBaseFieldTable(db, ITEM_BASE_FIELDS);
  return rows.map((row) => toItem(row, groupId, baseFieldTable));
}
