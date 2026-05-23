import {
  baseFieldMappingsCombined,
  creators,
  creatorTypes,
  deletedItems,
  fieldsCombined,
  itemCreators,
  itemData,
  itemDataValues,
  itemTypeCreatorTypes,
  itemTypes,
  items,
} from "@drizzle/schema";
import {
  and,
  desc,
  eq,
  inArray,
  isNull,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import { type Temporal } from "@zotlit/shared/temporal";

import { type NodeDatabaseClient } from "@/client/node";
import { type SQLocalDatabaseClient } from "@/client/web";

import { groupQueryBuilder } from "./_groups";
import { cachedPrepared } from "./_prepared";
import { CHILD_ITEM_TYPES, defineQuery, type QueryRow } from "./_shared";
import { formatIndexedKey } from "./items";

export interface IndexedCreator {
  firstName: string | null;
  lastName: string | null;
  fieldMode: number;
}

export interface IndexedItem {
  itemID: number;
  libraryID: number;
  key: string;
  indexedKey: string;
  dateModified: Temporal.Instant;
  itemType: string;
  primaryCreator: IndexedCreator | null;
  creators: readonly IndexedCreator[];
  language: string | null;
  title: string | null;
  publicationTitle: string | null;
  shortTitle: string | null;
  court: string | null;
  citationKey: string | null;
  date: string | null;
}

const INDEXED_FIELD_NAMES = [
  "title",
  "publicationTitle",
  "shortTitle",
  "court",
  "citationKey",
  "date",
  "language",
] as const;

type IndexedFieldName = (typeof INDEXED_FIELD_NAMES)[number];

type LibraryQueryParam = {
  libraryID: number;
};

function visibleItemsPredicate(excludedItemTypeIDs: readonly number[]) {
  return and(
    eq(items.libraryID, sql.placeholder("libraryID")),
    notInArray(items.itemTypeID, [...excludedItemTypeIDs]),
    isNull(deletedItems.itemID),
  );
}

const indexedItemRowsQueryBuilder = defineQuery(
  (db, excludedItemTypeIDs: readonly number[]) =>
    db
      .select({
        itemID: items.itemID,
        libraryID: items.libraryID,
        key: items.key,
        dateModified: items.dateModified,
        itemType: sql<string>`${itemTypes.typeName}`,
        primaryCreatorTypeID: itemTypeCreatorTypes.creatorTypeID,
      })
      .from(items)
      .innerJoin(itemTypes, eq(itemTypes.itemTypeID, items.itemTypeID))
      .leftJoin(
        itemTypeCreatorTypes,
        and(
          eq(itemTypeCreatorTypes.itemTypeID, items.itemTypeID),
          eq(itemTypeCreatorTypes.primaryField, 1),
        ),
      )
      .leftJoin(deletedItems, eq(deletedItems.itemID, items.itemID))
      .where(visibleItemsPredicate(excludedItemTypeIDs))
      .orderBy(desc(items.dateModified)),
);

const actualFields = alias(fieldsCombined, "actualFields");
const canonicalFields = alias(fieldsCombined, "canonicalFields");

const indexedItemDataRowsQueryBuilder = defineQuery(
  (db, excludedItemTypeIDs: readonly number[]) =>
    db
      .select({
        itemID: itemData.itemID,
        actualFieldName: actualFields.fieldName,
        canonicalFieldName: canonicalFields.fieldName,
        value: itemDataValues.value,
      })
      .from(itemData)
      .innerJoin(items, eq(items.itemID, itemData.itemID))
      .innerJoin(actualFields, eq(actualFields.fieldID, itemData.fieldID))
      .leftJoin(
        baseFieldMappingsCombined,
        and(
          eq(baseFieldMappingsCombined.itemTypeID, items.itemTypeID),
          eq(baseFieldMappingsCombined.fieldID, itemData.fieldID),
        ),
      )
      .leftJoin(
        canonicalFields,
        eq(canonicalFields.fieldID, baseFieldMappingsCombined.baseFieldID),
      )
      .leftJoin(itemDataValues, eq(itemDataValues.valueID, itemData.valueID))
      .leftJoin(deletedItems, eq(deletedItems.itemID, items.itemID))
      .where(
        and(
          visibleItemsPredicate(excludedItemTypeIDs),
          or(
            inArray(actualFields.fieldName, [...INDEXED_FIELD_NAMES]),
            inArray(canonicalFields.fieldName, [...INDEXED_FIELD_NAMES]),
          ),
        ),
      ),
);

const indexedCreatorRowsQueryBuilder = defineQuery(
  (db, excludedItemTypeIDs: readonly number[]) =>
    db
      .select({
        itemID: itemCreators.itemID,
        creatorTypeID: itemCreators.creatorTypeID,
        firstName: creators.firstName,
        lastName: creators.lastName,
        fieldMode: creators.fieldMode,
      })
      .from(itemCreators)
      .innerJoin(items, eq(items.itemID, itemCreators.itemID))
      .innerJoin(creators, eq(creators.creatorID, itemCreators.creatorID))
      .innerJoin(
        creatorTypes,
        eq(creatorTypes.creatorTypeID, itemCreators.creatorTypeID),
      )
      .leftJoin(deletedItems, eq(deletedItems.itemID, items.itemID))
      .where(visibleItemsPredicate(excludedItemTypeIDs))
      .orderBy(itemCreators.itemID, itemCreators.orderIndex),
);

const excludedItemTypeIDsQueryBuilder = defineQuery((db) =>
  db
    .select({ itemTypeID: itemTypes.itemTypeID })
    .from(itemTypes)
    .where(inArray(itemTypes.typeName, [...CHILD_ITEM_TYPES])),
);

type IndexedItemRow = QueryRow<typeof indexedItemRowsQueryBuilder>;
type IndexedItemDataRow = QueryRow<typeof indexedItemDataRowsQueryBuilder>;
type IndexedCreatorRow = QueryRow<typeof indexedCreatorRowsQueryBuilder>;

type IndexedCreatorWithType = IndexedCreator & {
  creatorTypeID: number;
};

const excludedTypeIDsByClient = new WeakMap<
  NodeDatabaseClient | SQLocalDatabaseClient,
  readonly number[]
>();

export function getIndexedItemsByLibrary(
  db: NodeDatabaseClient,
  libraryID: number,
): IndexedItem[] {
  const excludedTypeIDs = getExcludedItemTypeIDs(db);
  const queryParam = { libraryID } satisfies LibraryQueryParam;
  const itemRows = cachedPrepared(db, "indexed-items", (d) =>
    indexedItemRowsQueryBuilder(d, excludedTypeIDs).prepare(),
  ).all(queryParam);
  const fieldRows = cachedPrepared(db, "indexed-item-data", (d) =>
    indexedItemDataRowsQueryBuilder(d, excludedTypeIDs).prepare(),
  ).all(queryParam);
  const creatorRows = cachedPrepared(db, "indexed-item-creators", (d) =>
    indexedCreatorRowsQueryBuilder(d, excludedTypeIDs).prepare(),
  ).all(queryParam);
  const groupID =
    cachedPrepared(db, "groups", (d) => groupQueryBuilder(d).prepare()).get(
      queryParam,
    )?.groupID ?? null;

  return toIndexedItems({ itemRows, fieldRows, creatorRows, groupID });
}

export async function getIndexedItemsByLibraryAsync(
  db: SQLocalDatabaseClient,
  libraryID: number,
): Promise<IndexedItem[]> {
  const excludedTypeIDs = await getExcludedItemTypeIDsAsync(db);
  const queryParam = { libraryID } satisfies LibraryQueryParam;
  const [itemRows, fieldRows, creatorRows, [group]] = await Promise.all([
    indexedItemRowsQueryBuilder(db, excludedTypeIDs).prepare().all(queryParam),
    indexedItemDataRowsQueryBuilder(db, excludedTypeIDs)
      .prepare()
      .all(queryParam),
    indexedCreatorRowsQueryBuilder(db, excludedTypeIDs)
      .prepare()
      .all(queryParam),
    groupQueryBuilder(db).prepare().all(queryParam),
  ]);
  return toIndexedItems({
    itemRows,
    fieldRows,
    creatorRows,
    groupID: group?.groupID ?? null,
  });
}

function getExcludedItemTypeIDs(db: NodeDatabaseClient): readonly number[] {
  const cached = excludedTypeIDsByClient.get(db);
  if (cached) return cached;

  const ids = excludedItemTypeIDsQueryBuilder(db)
    .prepare()
    .all()
    .map((row) => row.itemTypeID);
  excludedTypeIDsByClient.set(db, ids);
  return ids;
}

async function getExcludedItemTypeIDsAsync(
  db: SQLocalDatabaseClient,
): Promise<readonly number[]> {
  const cached = excludedTypeIDsByClient.get(db);
  if (cached) return cached;

  const rows = await excludedItemTypeIDsQueryBuilder(db).prepare().all();
  const ids = rows.map((row) => row.itemTypeID);
  excludedTypeIDsByClient.set(db, ids);
  return ids;
}

function toIndexedItems({
  itemRows,
  fieldRows,
  creatorRows,
  groupID,
}: {
  itemRows: readonly IndexedItemRow[];
  fieldRows: readonly IndexedItemDataRow[];
  creatorRows: readonly IndexedCreatorRow[];
  groupID: number | null;
}): IndexedItem[] {
  const itemsByID = new Map<number, IndexedItem>();
  const primaryCreatorTypeByItemID = new Map<number, number | null>();
  const creatorsByItemID = new Map<number, IndexedCreatorWithType[]>();

  for (const row of itemRows) {
    primaryCreatorTypeByItemID.set(row.itemID, row.primaryCreatorTypeID);
    itemsByID.set(row.itemID, {
      itemID: row.itemID,
      libraryID: row.libraryID,
      key: row.key,
      indexedKey: formatIndexedKey(row.key, groupID),
      dateModified: row.dateModified,
      itemType: row.itemType,
      primaryCreator: null,
      creators: [],
      language: null,
      title: null,
      publicationTitle: null,
      shortTitle: null,
      court: null,
      citationKey: null,
      date: null,
    });
  }

  for (const row of fieldRows) {
    const item = row.itemID === null ? null : itemsByID.get(row.itemID);
    if (!item) continue;

    const fieldName = toIndexedFieldName(
      row.canonicalFieldName ?? row.actualFieldName,
    );
    if (!fieldName) continue;
    item[fieldName] = row.value;
  }

  for (const row of creatorRows) {
    const list = creatorsByItemID.get(row.itemID) ?? [];
    list.push({
      creatorTypeID: row.creatorTypeID,
      firstName: row.firstName,
      lastName: row.lastName,
      fieldMode: row.fieldMode ?? 0,
    });
    creatorsByItemID.set(row.itemID, list);
  }

  for (const [itemID, item] of itemsByID) {
    const typedCreators = creatorsByItemID.get(itemID) ?? [];
    const primaryCreatorTypeID = primaryCreatorTypeByItemID.get(itemID);
    const primaryTyped =
      primaryCreatorTypeID == null
        ? null
        : (typedCreators.find(
            (creator) => creator.creatorTypeID === primaryCreatorTypeID,
          ) ?? null);

    item.creators = typedCreators.map(stripCreatorType);
    item.primaryCreator = primaryTyped ? stripCreatorType(primaryTyped) : null;
  }

  return itemRows.flatMap((row) => itemsByID.get(row.itemID) ?? []);
}

function toIndexedFieldName(value: string | null): IndexedFieldName | null {
  return INDEXED_FIELD_NAMES.includes(value as IndexedFieldName)
    ? (value as IndexedFieldName)
    : null;
}

function stripCreatorType(creator: IndexedCreatorWithType): IndexedCreator {
  const { creatorTypeID: _typeID, ...rest } = creator;
  return rest;
}
