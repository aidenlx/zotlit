import { deletedItems, itemTypes } from "@drizzle/schema";
import { eq, sql } from "drizzle-orm";

import { type Temporal } from "@zotlit/shared/temporal";

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
  itemType: string;
  title: string | null;
  citekey: string | null;
  date: string | null;
  /** UTC instant from Zotero's `dateModified` text column. */
  dateModified: Temporal.Instant;
  creators: Creator[];
}

export interface JournalArticleItem extends BaseItem {
  itemType: "journalArticle";
  publicationTitle: string | null;
  volume: string | null;
  issue: string | null;
  pages: string | null;
}

export type Item = BaseItem | JournalArticleItem;

export function isJournalArticleItem(item: Item): item is JournalArticleItem {
  return item.itemType === "journalArticle";
}

export function formatIndexedKey(
  key: string,
  groupID: number | null | undefined,
): string {
  return groupID == null ? key : `${key}g${groupID}`;
}

const queryBuilder = defineQuery((db) =>
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
      itemType: (t) =>
        db
          .select({ itemType: itemTypes.typeName })
          .from(itemTypes)
          .where(eq(itemTypes.itemTypeID, t.itemTypeID))
          .limit(1),
    },
    with: {
      library: {
        columns: {},
        with: {
          groups: { columns: { groupID: true } },
        },
      },
      itemData: {
        columns: {},
        with: {
          fieldsCombined: { columns: { fieldName: true } },
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

type ItemRow = QueryRow<typeof queryBuilder>;

function toItem(row: ItemRow): Item {
  const fields = new Map<string, string | null>();
  for (const d of row.itemData) {
    if (!d.fieldsCombined) continue;
    fields.set(d.fieldsCombined.fieldName, d.itemDataValue?.value ?? null);
  }
  const creators: Creator[] = row.itemCreators.map((ic) => ({
    firstName: ic.creator?.firstName ?? null,
    lastName: ic.creator?.lastName ?? null,
    creatorType: ic.creatorType?.creatorType ?? "",
    fieldMode: ic.creator?.fieldMode ?? 0,
  }));
  const groupID = row.library?.groups?.groupID ?? null;
  const itemType = (row.itemType as string) ?? "";
  const base: BaseItem = {
    itemID: row.itemID,
    libraryID: row.libraryID,
    key: row.key,
    indexedKey: formatIndexedKey(row.key, groupID),
    itemType,
    title: fields.get("title") ?? null,
    citekey: fields.get("citationKey") ?? null,
    date: fields.get("date") ?? null,
    dateModified: row.dateModified,
    creators,
  };
  if (itemType === "journalArticle") {
    return {
      ...base,
      itemType: "journalArticle",
      publicationTitle: fields.get("publicationTitle") ?? null,
      volume: fields.get("volume") ?? null,
      issue: fields.get("issue") ?? null,
      pages: fields.get("pages") ?? null,
    };
  }
  return base;
}

export function getItemsByLibrary(
  db: NodeDatabaseClient,
  libraryID: number,
): Item[] {
  const stmt = cachedPrepared(db, "items", (d) => queryBuilder(d).prepare());
  return stmt.all({ libraryID }).map(toItem);
}

export async function getItemsByLibraryAsync(
  db: SQLocalDatabaseClient,
  libraryID: number,
): Promise<Item[]> {
  const rows = await queryBuilder(db).prepare().all({ libraryID });
  return rows.map(toItem);
}
