import {
  creatorTypes,
  deletedItems,
  groups,
  itemTypeCreatorTypes,
  itemTypes,
} from "@drizzle/schema";
import { eq, sql } from "drizzle-orm";

import { type Temporal } from "@zotlit/shared/temporal";

import { type NodeDatabaseClient } from "@/client/node";
import { type SQLocalDatabaseClient } from "@/client/web";
import { parseItemDate, type ItemDate } from "@/lib/zt-date";
import {
  parseItemLanguage,
  type ItemLanguage,
  type LanguageNameLookup,
} from "@/lib/zt-lang";

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
  date: ItemDate | null;
  /** UTC instant from Zotero's `dateModified` text column. */
  dateModified: Temporal.Instant;
  creators: Creator[];
  /**
   * Creator-type name that Zotero treats as primary for this item type
   * (e.g. `author` for journalArticle/book, `interviewer` for interview,
   * `podcaster` for podcast).
   */
  primaryCreatorType: string | null;
  /** Parsed `language` field. @see {@link ItemLanguage} */
  language: ItemLanguage | null;
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

export interface ItemQueryOptions {
  lookup: LanguageNameLookup | null;
}

function toItem(
  row: ItemRow,
  groupID: number | null,
  lookup: LanguageNameLookup | null,
): Item {
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
  const itemType = row.itemType;
  const base: BaseItem = {
    itemID: row.itemID,
    libraryID: row.libraryID,
    key: row.key,
    indexedKey: formatIndexedKey(row.key, groupID),
    itemType,
    title: fields.get("title") ?? null,
    citekey: fields.get("citationKey") ?? null,
    date: parseItemDate(fields.get("date")),
    dateModified: row.dateModified,
    creators,
    primaryCreatorType: row.primaryCreatorType,
    language: parseItemLanguage(fields.get("language"), lookup),
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
  { lookup }: ItemQueryOptions,
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
    .map((r) => toItem(r, groupId, lookup));
}

export async function getItemsByLibraryAsync(
  db: SQLocalDatabaseClient,
  libraryID: number,
  { lookup }: ItemQueryOptions,
): Promise<Item[]> {
  const rows = await itemQueryBuilder(db)
    .prepare()
    .all({ libraryID } satisfies ItemQueryParam);
  const [group] = await groupQueryBuilder(db)
    .prepare()
    .all({ libraryID } satisfies GroupQueryParam);
  const groupId = group?.groupID ?? null;
  return rows.map((r) => toItem(r, groupId, lookup));
}
