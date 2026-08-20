import { deletedItems, items, itemTypes } from "@drizzle/schema";
import { and, count, eq, isNull, notInArray, sql } from "drizzle-orm";

import type { NodeDatabaseClient } from "@/client/node";
import type { CreatorFieldMode } from "@/lib/zt-creator";
import { formatIndexedKey } from "@/lib/zt-key";

import { groupsQuery, resolveGroupID } from "./_groups";
import type { GroupIDMemo } from "./_groups";
import { CHILD_ITEM_TYPES, defineQuery } from "./_shared";
import type { FindManyOptions, QueryRow } from "./_shared";

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

const mappingByClient = new WeakMap<NodeDatabaseClient, FieldMapping>();

/**
 * Shared `columns` + `with` projection for the indexed-item queries (by library
 * and by id). The `itemData` relation filters to `indexedFieldIDs`, so the
 * projection is parameterized rather than a module-level constant.
 */
function indexedItemRelations(indexedFieldIDs: readonly number[]) {
  return {
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
        where: { fieldID: { in: [...indexedFieldIDs] } },
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
  } satisfies FindManyOptions<"items">;
}

const indexedItemsQuery = defineQuery<{ libraryID: number }>()(
  (db, { placeholder }, args: { indexedFieldIDs: readonly number[] }) =>
    db.query.items.findMany({
      where: {
        libraryID: placeholder("libraryID"),
        itemType: { typeName: { notIn: [...CHILD_ITEM_TYPES] } },
        deletedItem: false,
      },
      ...indexedItemRelations(args.indexedFieldIDs),
      orderBy: { dateModified: "desc" },
    }),
);

/** Lightweight id-only pass: ordered ids for a library's indexed items. */
const indexedItemIDsByLibraryQuery = defineQuery<{ libraryID: number }>()(
  (db, { placeholder }) =>
    db.query.items.findMany({
      where: {
        libraryID: placeholder("libraryID"),
        itemType: { typeName: { notIn: [...CHILD_ITEM_TYPES] } },
        deletedItem: false,
      },
      columns: { itemID: true },
      orderBy: { dateModified: "desc" },
    }),
);

/** Single-id hydration matching {@link indexedItemsQuery}'s projection. */
const indexedItemByIdQuery = defineQuery<{ itemID: number }>()(
  (db, { placeholder }, args: { indexedFieldIDs: readonly number[] }) =>
    db.query.items.findMany({
      where: {
        itemID: placeholder("itemID"),
        itemType: { typeName: { notIn: [...CHILD_ITEM_TYPES] } },
        deletedItem: false,
      },
      ...indexedItemRelations(args.indexedFieldIDs),
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

/**
 * Ordered (dateModified desc) item ids for a library — the lightweight first
 * pass of a chunked index build. Hydrate each chunk via {@link getIndexedItemsByID}.
 */
export function getIndexedItemIDsByLibrary(
  db: NodeDatabaseClient,
  libraryID: number,
): number[] {
  return indexedItemIDsByLibraryQuery
    .prepared(db)
    .all({ libraryID })
    .map((row) => row.itemID);
}

/**
 * Hydrate {@link IndexedItem}s for a chunk of item ids with one prepared per-id
 * query each, mirroring {@link getItemsByID}. Item ids are unique across
 * libraries, so each row resolves its own `groupID`/`indexedKey`.
 */
export function getIndexedItemsByID(
  db: NodeDatabaseClient,
  itemIDs: readonly number[],
): IndexedItem[] {
  if (itemIDs.length === 0) return [];
  const mapping = getMappingSync(db);
  const stmt = indexedItemByIdQuery.prepared(db, {
    indexedFieldIDs: mapping.indexedFieldIDs,
  });
  const memo: GroupIDMemo = new Map();
  return itemIDs.flatMap((itemID) =>
    stmt
      .all({ itemID })
      .map((row) =>
        toIndexedItem(row, resolveGroupID(db, row.libraryID, memo), mapping),
      ),
  );
}

/** Cheap change-detection signature for a library's indexed items. */
export interface IndexSignature {
  count: number;
  /**
   * Order-insensitive checksum over each indexed row's `(unixepoch(dateModified)
   * + itemID)`. It moves whenever a row is added, removed, or its `dateModified`
   * changes to a different second — including a non-max edit that lands in the
   * current library's max second, which a bare `max(dateModified)` cannot see.
   * Zotero stamps `dateModified` (second resolution) on every item save, so under
   * normal forward writes any indexed change shifts the checksum.
   *
   * Residual blind spots, both off Zotero's normal save path: two same-window
   * edits whose second-deltas exactly cancel (one row's `dateModified` moved
   * earlier by the seconds another moved later), and a same-second re-edit of one
   * row (the stored second does not change). Exact integer arithmetic, within JS
   * safe-integer range for realistic library sizes.
   */
  checksum: number;
}

/**
 * Aggregate over the same row set as {@link indexedItemsQuery} (library, non-child
 * type, not deleted) in one pass, yielding the {@link IndexSignature} fields.
 *
 * @see unixepoch — https://www.sqlite.org/lang_datefunc.html
 */
const indexSignatureQuery = defineQuery<{ libraryID: number }>()(
  (db, { placeholder }) =>
    db
      .select({
        count: count(),
        checksum: sql<number>`coalesce(sum(unixepoch(${items.dateModified}) + ${items.itemID}), 0)`,
      })
      .from(items)
      .innerJoin(itemTypes, eq(itemTypes.itemTypeID, items.itemTypeID))
      .leftJoin(deletedItems, eq(deletedItems.itemID, items.itemID))
      .where(
        and(
          eq(items.libraryID, placeholder("libraryID")),
          notInArray(itemTypes.typeName, [...CHILD_ITEM_TYPES]),
          isNull(deletedItems.itemID),
        ),
      ),
);

/**
 * Read a library's {@link IndexSignature} in one aggregate query — the gate that
 * lets the item-lookup service skip a rebuild when nothing indexed changed.
 */
export function getIndexSignature(
  db: NodeDatabaseClient,
  libraryID: number,
): IndexSignature {
  const row = indexSignatureQuery.prepared(db).get({ libraryID });
  return {
    count: row?.count ?? 0,
    checksum: Number(row?.checksum ?? 0),
  };
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
