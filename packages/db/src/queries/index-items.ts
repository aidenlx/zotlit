import { type Temporal } from "@zotlit/shared/temporal";

import { type NodeDatabaseClient } from "@/client/node";
import { type SQLocalDatabaseClient } from "@/client/web";
import { type CreatorFieldMode } from "@/lib/zt-creator";

import { groupsQuery } from "./_groups";
import { CHILD_ITEM_TYPES, defineQuery, type QueryRow } from "./_shared";
import { formatIndexedKey } from "./items";

export interface IndexedCreator {
  firstName: string | null;
  lastName: string | null;
  fieldMode: CreatorFieldMode;
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

const canonicalFieldsQuery = defineQuery<void>()((db) =>
  db.query.fieldsCombined.findMany({
    where: { fieldName: { in: [...INDEXED_FIELD_NAMES] } },
    columns: { fieldID: true, fieldName: true },
  }),
);

const aliasFieldsQuery = defineQuery<void>()((db) =>
  db.query.baseFieldMappingsCombined.findMany({
    where: { baseField: { fieldName: { in: [...INDEXED_FIELD_NAMES] } } },
    columns: { itemTypeID: true, fieldID: true },
    with: { baseField: { columns: { fieldName: true } } },
  }),
);

/**
 * Resolution table for the canonical/actual fieldName split. RQB v2 can't
 * express the join inline because `baseFieldMappingsCombined` must match on
 * the parent `items.itemTypeID` plus the child `itemData.fieldID`, and v2
 * `where` clauses can't reference the parent. Precomputed once per client.
 */
interface FieldMapping {
  /** fieldIDs to fetch — union of canonical IDs and per-itemType alias IDs. */
  indexedFieldIDs: readonly number[];
  /** Direct match: a field whose own name is one of `INDEXED_FIELD_NAMES`. */
  canonicalByFieldID: ReadonlyMap<number, IndexedFieldName>;
  /** Per-itemType alias: `${itemTypeID}:${fieldID}` → canonical name. */
  aliasByTypeAndField: ReadonlyMap<string, IndexedFieldName>;
}

const mappingByClient = new WeakMap<
  NodeDatabaseClient | SQLocalDatabaseClient,
  FieldMapping
>();

const indexedItemsQuery = defineQuery<{ libraryID: number }>()(
  (db, { placeholder }, args: { indexedFieldIDs: readonly number[] }) =>
    db.query.items.findMany({
      where: {
        libraryID: placeholder("libraryID"),
        itemType: { typeName: { notIn: [...CHILD_ITEM_TYPES] } },
        deletedItem: false,
      },
      columns: {
        itemID: true,
        libraryID: true,
        key: true,
        dateModified: true,
        itemTypeID: true,
      },
      with: {
        itemType: {
          columns: { typeName: true },
          with: {
            itemTypeCreatorTypes: {
              columns: { creatorTypeID: true },
              where: { primaryField: { eq: 1 } },
              limit: 1,
            },
          },
        },
        itemData: {
          columns: { fieldID: true },
          where: { fieldID: { in: [...args.indexedFieldIDs] } },
          with: {
            itemDataValue: { columns: { value: true } },
          },
        },
        itemCreators: {
          columns: { creatorTypeID: true },
          orderBy: { orderIndex: "asc" },
          with: {
            creator: {
              columns: { firstName: true, lastName: true, fieldMode: true },
            },
          },
        },
      },
      orderBy: { dateModified: "desc" },
    }),
);

type IndexedItemRow = QueryRow<typeof indexedItemsQuery>;

export function getIndexedItemsByLibrary(
  db: NodeDatabaseClient,
  libraryID: number,
): IndexedItem[] {
  const mapping = getMappingSync(db);
  const rows = indexedItemsQuery
    .prepared(db, { indexedFieldIDs: mapping.indexedFieldIDs })
    .all({ libraryID });
  const groupID = groupsQuery.prepared(db).get({ libraryID })?.groupID ?? null;
  return rows.map((row) => toIndexedItem(row, groupID, mapping));
}

export async function getIndexedItemsByLibraryAsync(
  db: SQLocalDatabaseClient,
  libraryID: number,
): Promise<IndexedItem[]> {
  const mapping = await getMappingAsync(db);
  const [rows, [group]] = await Promise.all([
    indexedItemsQuery
      .prepared(db, { indexedFieldIDs: mapping.indexedFieldIDs })
      .all({ libraryID }),
    groupsQuery.prepared(db).all({ libraryID }),
  ]);
  return rows.map((row) => toIndexedItem(row, group?.groupID ?? null, mapping));
}

function getMappingSync(db: NodeDatabaseClient): FieldMapping {
  const cached = mappingByClient.get(db);
  if (cached) return cached;
  const canonicalRows = canonicalFieldsQuery.prepared(db).all();
  const aliasRows = aliasFieldsQuery.prepared(db).all();
  const mapping = buildMapping(canonicalRows, aliasRows);
  mappingByClient.set(db, mapping);
  return mapping;
}

async function getMappingAsync(
  db: SQLocalDatabaseClient,
): Promise<FieldMapping> {
  const cached = mappingByClient.get(db);
  if (cached) return cached;
  const [canonicalRows, aliasRows] = await Promise.all([
    canonicalFieldsQuery.prepared(db).all(),
    aliasFieldsQuery.prepared(db).all(),
  ]);
  const mapping = buildMapping(canonicalRows, aliasRows);
  mappingByClient.set(db, mapping);
  return mapping;
}

type CanonicalFieldRow = QueryRow<typeof canonicalFieldsQuery>;
type AliasFieldRow = QueryRow<typeof aliasFieldsQuery>;

function buildMapping(
  canonicalRows: readonly CanonicalFieldRow[],
  aliasRows: readonly AliasFieldRow[],
): FieldMapping {
  const canonicalByFieldID = new Map<number, IndexedFieldName>();
  for (const row of canonicalRows) {
    if (isIndexedFieldName(row.fieldName)) {
      canonicalByFieldID.set(row.fieldID, row.fieldName);
    }
  }
  const aliasByTypeAndField = new Map<string, IndexedFieldName>();
  const indexedFieldIDs = new Set<number>(canonicalByFieldID.keys());
  for (const row of aliasRows) {
    if (row.fieldID == null) continue;
    indexedFieldIDs.add(row.fieldID);
    if (row.itemTypeID == null) continue;
    const canonical = row.baseField?.fieldName;
    if (!canonical || !isIndexedFieldName(canonical)) continue;
    aliasByTypeAndField.set(`${row.itemTypeID}:${row.fieldID}`, canonical);
  }
  return {
    indexedFieldIDs: [...indexedFieldIDs],
    canonicalByFieldID,
    aliasByTypeAndField,
  };
}

function isIndexedFieldName(value: string): value is IndexedFieldName {
  return INDEXED_FIELD_NAMES.includes(value as IndexedFieldName);
}

function toIndexedItem(
  row: IndexedItemRow,
  groupID: number | null,
  mapping: FieldMapping,
): IndexedItem {
  const item: IndexedItem = {
    itemID: row.itemID,
    libraryID: row.libraryID,
    key: row.key,
    indexedKey: formatIndexedKey(row.key, groupID),
    dateModified: row.dateModified,
    itemType: row.itemType.typeName ?? "",
    primaryCreator: null,
    creators: [],
    language: null,
    title: null,
    publicationTitle: null,
    shortTitle: null,
    court: null,
    citationKey: null,
    date: null,
  };

  for (const data of row.itemData) {
    const name = resolveIndexedFieldName(row.itemTypeID, data.fieldID, mapping);
    if (!name) continue;
    item[name] = data.itemDataValue?.value ?? null;
  }

  const primaryTypeID =
    row.itemType.itemTypeCreatorTypes[0]?.creatorTypeID ?? null;
  const creators: IndexedCreator[] = [];
  let primaryCreator: IndexedCreator | null = null;
  for (const ic of row.itemCreators) {
    const creator: IndexedCreator = {
      firstName: ic.creator?.firstName ?? null,
      lastName: ic.creator?.lastName ?? null,
      fieldMode: ic.creator?.fieldMode ?? 0,
    };
    creators.push(creator);
    if (
      !primaryCreator &&
      primaryTypeID != null &&
      ic.creatorTypeID === primaryTypeID
    ) {
      primaryCreator = creator;
    }
  }
  item.creators = creators;
  item.primaryCreator = primaryCreator;
  return item;
}

function resolveIndexedFieldName(
  itemTypeID: number,
  fieldID: number | null,
  mapping: FieldMapping,
): IndexedFieldName | null {
  if (fieldID == null) return null;
  const alias = mapping.aliasByTypeAndField.get(`${itemTypeID}:${fieldID}`);
  if (alias) return alias;
  return mapping.canonicalByFieldID.get(fieldID) ?? null;
}
