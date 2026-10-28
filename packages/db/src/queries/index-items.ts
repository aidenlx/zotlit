import { deletedItems, items, itemTypes } from "@drizzle/schema";
import { and, count, eq, gte, isNull, lt, notInArray, sql } from "drizzle-orm";

import type { NodeDatabaseClient } from "@/client/node";
import type { CreatorFieldMode } from "@/lib/zt-creator";
import { formatIndexedKey } from "@/lib/zt-key";

import { getBaseFieldTable } from "./_base-fields";
import type { BaseFieldTable } from "./_base-fields";
import { CHILD_ITEM_TYPES, defineQuery, defineKeyedQuery } from "./_shared";
import type { FindManyOptions, QueryRow } from "./_shared";
import { groupIDForLibrary, resolveGroupID } from "./libraries";
import type { GroupIDMemo } from "./libraries";

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
  /** Zotero Last Activity as epoch milliseconds, before request Uses. */
  lastActivity: number | null;
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

/** Hydration of a chunk of ids, matching {@link indexedItemsQuery}'s projection. */
const indexedItemsByIdsQuery = defineKeyedQuery<number>()(
  (
    db,
    { contains },
    args: {
      indexedFieldIDs: readonly number[];
    },
  ) =>
    db.query.items.findMany({
      where: {
        RAW: (item) => contains(item.itemID),
        itemType: { typeName: { notIn: [...CHILD_ITEM_TYPES] } },
        deletedItem: false,
      },
      ...indexedItemRelations(args.indexedFieldIDs),
    }),
  { keyOf: (row) => row.itemID },
);

// Each subquery starts from a parent-indexed relation, keeping a build chunk bounded.
// Match Item Query's live relations: readable Attachments, Child Notes, and
// Annotations whose Attachment and Annotation are both outside the trash.
const zoteroActivity = sql<number | null>`(select max(activity) from (
  select unixepoch(${items}."dateAdded") * 1000 as activity
  union all
  select a.lastRead * 1000 from itemAttachments a
    where a.parentItemID = ${items}."itemID" and a.linkMode in (0, 1, 2, 3)
      and not exists (select 1 from deletedItems d where d.itemID = a.itemID)
  union all
  select unixepoch(n.dateModified) * 1000 from itemNotes r join items n on n.itemID = r.itemID
    where r.parentItemID = ${items}."itemID"
      and not exists (select 1 from deletedItems d where d.itemID = n.itemID)
  union all
  select unixepoch(n.dateModified) * 1000 from itemAttachments a
    join itemAnnotations r on r.parentItemID = a.itemID join items n on n.itemID = r.itemID
    where a.parentItemID = ${items}."itemID"
      and not exists (select 1 from deletedItems d where d.itemID = a.itemID)
      and not exists (select 1 from deletedItems d where d.itemID = n.itemID)
))`;

const activityByIDs = defineKeyedQuery<number>()(
  (db, { contains }) =>
    db
      .select({ itemID: items.itemID, lastActivity: zoteroActivity })
      .from(items)
      .where(contains(items.itemID)),
  { keyOf: (row) => row.itemID },
);

type IndexedItemRow = QueryRow<typeof indexedItemsQuery>;

export function getIndexedItemsByLibrary(
  db: NodeDatabaseClient,
  libraryID: number,
): IndexedItem[] {
  const table = getBaseFieldTable(db, INDEXED_FIELD_NAMES);
  const rows = indexedItemsQuery
    .prepared(db, { indexedFieldIDs: table.fieldIDs })
    .all({ libraryID });
  const groupID = groupIDForLibrary(db, libraryID);
  const activity = new Map(
    activityByIDs(
      db,
      rows.map((row) => row.itemID),
    ).map((row) => [row.itemID, row.lastActivity]),
  );
  return rows.map((row) =>
    toIndexedItem(
      { ...row, lastActivity: activity.get(row.itemID) ?? null },
      groupID,
      table,
    ),
  );
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
 * Hydrate {@link IndexedItem}s through one cached keyed read, in
 * `itemIDs` order. Item ids are unique across libraries, so each row resolves
 * its own `groupID`/`indexedKey`.
 */
export function getIndexedItemsByID(
  db: NodeDatabaseClient,
  itemIDs: readonly number[],
  opts?: { memo?: GroupIDMemo },
): IndexedItem[] {
  if (itemIDs.length === 0) return [];
  const table = getBaseFieldTable(db, INDEXED_FIELD_NAMES);
  const memo = opts?.memo ?? new Map();
  const activity = new Map(
    activityByIDs(db, itemIDs).map((row) => [row.itemID, row.lastActivity]),
  );
  return indexedItemsByIdsQuery(db, itemIDs, {
    args: { indexedFieldIDs: table.fieldIDs },
  }).map((row) =>
    toIndexedItem(
      { ...row, lastActivity: activity.get(row.itemID) ?? null },
      resolveGroupID(db, row.libraryID, memo),
      table,
    ),
  );
}

/** Cheap change-detection signature for a library's indexed items. */
export interface IndexSignature {
  count: number;
  /**
   * Sum of parent modification seconds, Item IDs, and an ID-weighted activity
   * hash. Weighting ties activity to its parent, so moving a child invalidates
   * the index even when the sum of parent activities stays equal. The modulus
   * bounds each contribution below 2^31 and the library sum stays a safe integer.
   * Like any checksum, collisions and same-second edits remain possible.
   */
  checksum: number;
}

/** One indexed row's term of {@link IndexSignature.checksum}. */
const checksumTerm = sql<number>`unixepoch(${items.dateModified}) + ${items.itemID} + (coalesce(${zoteroActivity} / 1000, 0) * ((${items.itemID} % 997) + 1) % 2147483647)`;

/**
 * Aggregate over the same row set as {@link indexedItemsQuery} (library, non-child
 * type, not deleted) whose Item IDs fall in `[from, to)`, yielding the
 * {@link IndexSignature} fields of that range. Both fields are sums over rows,
 * so the parts of disjoint ranges add up to the Library's signature.
 *
 * @see unixepoch — https://www.sqlite.org/lang_datefunc.html
 */
const indexSignatureRangeQuery = defineQuery<{
  libraryID: number;
  from: number;
  to: number;
}>()((db, { placeholder }) =>
  db
    .select({
      count: count(),
      checksum: sql<number>`coalesce(sum(${checksumTerm}), 0)`,
    })
    .from(items)
    .innerJoin(itemTypes, eq(itemTypes.itemTypeID, items.itemTypeID))
    .leftJoin(deletedItems, eq(deletedItems.itemID, items.itemID))
    .where(
      and(
        eq(items.libraryID, placeholder("libraryID")),
        gte(items.itemID, placeholder("from")),
        lt(items.itemID, placeholder("to")),
        notInArray(itemTypes.typeName, [...CHILD_ITEM_TYPES]),
        isNull(deletedItems.itemID),
      ),
    ),
);

const itemIDBoundsQuery = defineQuery<{ libraryID: number }>()(
  (db, { placeholder }) =>
    db
      .select({
        min: sql<number | null>`min(${items.itemID})`,
        max: sql<number | null>`max(${items.itemID})`,
      })
      .from(items)
      .where(eq(items.libraryID, placeholder("libraryID"))),
);

/**
 * The lowest and highest Item ID in a Library, of any type, or null when it
 * has no Items. The ranges of {@link getIndexSignatureRange} cover this span.
 */
export function getItemIDBounds(
  db: NodeDatabaseClient,
  libraryID: number,
): { min: number; max: number } | null {
  const row = itemIDBoundsQuery.prepared(db).get({ libraryID });
  if (row?.min == null || row.max == null) return null;
  return { min: row.min, max: row.max };
}

/**
 * The part of a Library's {@link IndexSignature} from the Items whose IDs fall
 * in `[from, to)`. The gate that lets the item-lookup service skip a rebuild
 * when nothing indexed changed sums these parts over the Library's Item ID
 * span, one range per task, so no single read holds the worker for long.
 */
export function getIndexSignatureRange(
  db: NodeDatabaseClient,
  libraryID: number,
  { from, to }: { from: number; to: number },
): IndexSignature {
  const row = indexSignatureRangeQuery
    .prepared(db)
    .get({ libraryID, from, to });
  return {
    count: row?.count ?? 0,
    checksum: Number(row?.checksum ?? 0),
  };
}

/** A Library's whole {@link IndexSignature}: one range over every Item ID. */
export function getIndexSignature(
  db: NodeDatabaseClient,
  libraryID: number,
): IndexSignature {
  return getIndexSignatureRange(db, libraryID, {
    from: Number.MIN_SAFE_INTEGER,
    to: Number.MAX_SAFE_INTEGER,
  });
}

function toIndexedItem(
  row: IndexedItemRow & { lastActivity: number | null },
  groupID: number | null,
  table: BaseFieldTable<IndexedFieldName>,
): IndexedItem {
  const item: IndexedItem = {
    itemID: row.itemID,
    libraryID: row.libraryID,
    key: row.key,
    indexedKey: formatIndexedKey(row.key, groupID),
    dateModified: row.dateModified,
    lastActivity: row.lastActivity,
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
    const name = table.resolve(row.itemTypeID, data.fieldID);
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
