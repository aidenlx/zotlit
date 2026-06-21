import { type Temporal } from "@zotlit/shared/temporal";
import { type ItemFields } from "@zotlit/zotero-types";

import { type NodeDatabaseClient } from "@/client/node";
import { type SQLocalDatabaseClient } from "@/client/web";
import { type CreatorFieldMode } from "@/lib/zt-creator";
import { itemDateYear, parseItemDate } from "@/lib/zt-date";
import { formatIndexedKey } from "@/lib/zt-key";

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
  customFields: ReadonlyMap<string, string | null>;
}

export type Item = BaseItem & { fields: ItemFields };

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

const itemRefByIdQuery = defineQuery<{ itemID: number }>()(
  (db, { placeholder }) =>
    db.query.items.findFirst({
      columns: { key: true, libraryID: true },
      where: { itemID: placeholder("itemID"), deletedItem: false },
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
    customFields,
    fields: { itemType: row.itemType.typeName, ...namedProps } as ItemFields,
  };
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

/** A Zotero item resolved to its key + owning library, library-scope-free. */
export interface ItemRef {
  itemID: number;
  key: string;
  libraryID: number;
  /** `groups.groupID` for a group library, `null` for the user library. */
  groupID: number | null;
  /** `key`, or `key + 'g' + groupID` for group-library items. */
  indexedKey: string;
}

/**
 * Resolve a Zotero item to its key + owning library by global item id, with no
 * caller-supplied library scope. Item ids are unique across libraries, so the
 * Zotero reader's `itemID` (which travels without a library) maps cleanly here.
 *
 * @returns the {@link ItemRef}, or `null` when no live item has that id.
 */
export function getItemRefByID(
  db: NodeDatabaseClient,
  itemID: number,
): ItemRef | null {
  const row = itemRefByIdQuery.prepared(db).get({ itemID });
  if (!row) return null;
  const groupID =
    groupsQuery.prepared(db).get({ libraryID: row.libraryID })?.groupID ?? null;
  return {
    itemID,
    key: row.key,
    libraryID: row.libraryID,
    groupID,
    indexedKey: formatIndexedKey(row.key, groupID),
  };
}

/** Lightweight display fields for the annotation view's item identity label. */
export interface ItemDisplayInfo {
  title: string | null;
  creators: {
    firstName: string | null;
    lastName: string | null;
    fieldMode: CreatorFieldMode;
  }[];
  year: number | null;
}

const itemDisplayInfoQuery = defineQuery<{ itemID: number }>()(
  (db, { placeholder }) =>
    db.query.items.findFirst({
      columns: {},
      where: { itemID: placeholder("itemID"), deletedItem: false },
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
          },
        },
      },
    }),
);

/**
 * Fetch title, creators, and year for a single item by global item id.
 * Used by the annotation view to build the item identity label.
 */
export function getItemDisplayInfoByID(
  db: NodeDatabaseClient,
  itemID: number,
): ItemDisplayInfo | null {
  const row = itemDisplayInfoQuery.prepared(db).get({ itemID });
  if (!row) return null;

  let title: string | null = null;
  let dateRaw: string | null = null;
  for (const d of row.itemData) {
    if (!d.fieldsCombined || d.fieldsCombined.custom === 1) continue;
    if (d.fieldsCombined.fieldName === "title") {
      title = d.itemDataValue?.value ?? null;
    } else if (d.fieldsCombined.fieldName === "date") {
      dateRaw = d.itemDataValue?.value ?? null;
    }
  }

  const creators = row.itemCreators.map((ic) => ({
    firstName: ic.creator?.firstName ?? null,
    lastName: ic.creator?.lastName ?? null,
    fieldMode: (ic.creator?.fieldMode ?? 0) as CreatorFieldMode,
  }));

  return {
    title,
    creators,
    year: itemDateYear(parseItemDate(dateRaw)),
  };
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
