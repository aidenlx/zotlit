import {
  creatorTypes,
  deletedItems,
  groups,
  itemTypeCreatorTypes,
  itemTypes,
} from "@drizzle/schema";
import { eq, sql } from "drizzle-orm";

import { type Temporal } from "@zotlit/shared/temporal";
import { type ItemFields } from "@zotlit/zotero-types";

import { type NodeDatabaseClient } from "@/client/node";
import { type SQLocalDatabaseClient } from "@/client/web";

import { cachedPrepared } from "./_prepared";
import { defineQuery, type QueryRow } from "./_shared";

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
const itemQueryBuilder = defineQuery((db) =>
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
                .where(
                  inArray(itemTypes.typeName, [
                    "attachment",
                    "note",
                    "annotation",
                  ]),
                ),
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

type GroupQueryParam = {
  libraryID: number;
};
const groupQueryBuilder = defineQuery((db) =>
  db
    .select({ groupID: groups.groupID })
    .from(groups)
    .where(eq(groups.libraryID, sql.placeholder("libraryID")))
    .limit(1),
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
  const stmt = cachedPrepared(db, "items", (d) =>
    itemQueryBuilder(d).prepare(),
  );
  const groupStmt = cachedPrepared(db, "groups", (d) =>
    groupQueryBuilder(d).prepare(),
  );
  const groupId =
    groupStmt.all({ libraryID } satisfies GroupQueryParam)[0]?.groupID ?? null;
  return stmt
    .all({ libraryID } satisfies ItemQueryParam)
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
