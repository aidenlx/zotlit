import type { NodeDatabaseClient } from "@/client/node";
import { readDatabaseLayout } from "@/layout";
import type { Annotation } from "@/lib/zt-annot";
import { formatIndexedKey } from "@/lib/zt-key";

import { defineQuery, defineKeyedQuery } from "./_shared";
import type { FindManyOptions, QueryRow } from "./_shared";
import { groupIDForLibrary, resolveGroupID } from "./libraries";
import type { GroupIDMemo } from "./libraries";

const annotationFindOptions = {
  with: {
    item: {
      columns: {
        key: true,
        libraryID: true,
        dateAdded: true,
        dateModified: true,
        clientVersion: true,
      },
      with: {
        itemTags: {
          columns: { type: true },
          with: { tag: { columns: { name: true } } },
        },
        groupItem: { columns: { createdByUserID: true } },
      },
    },
    parentAttachment: {
      columns: {},
      with: { item_itemID: { columns: { key: true } } },
    },
  },
  orderBy: { sortIndex: "asc" },
} satisfies FindManyOptions<"itemAnnotations">;

const legacyAnnotationFindOptions = {
  ...annotationFindOptions,
  with: {
    ...annotationFindOptions.with,
    item: {
      ...annotationFindOptions.with.item,
      columns: {
        key: true,
        libraryID: true,
        dateAdded: true,
        dateModified: true,
      },
    },
  },
} satisfies FindManyOptions<"itemAnnotations">;

const annotationsByParentQuery = defineQuery<{ parentItemID: number }>()(
  (db, { placeholder }) =>
    db.query.itemAnnotations.findMany({
      where: {
        parentItemID: placeholder("parentItemID"),
        item: { deletedItem: false },
      },
      ...annotationFindOptions,
    }),
);

const legacyAnnotationsByParentQuery = defineQuery<{ parentItemID: number }>()(
  (db, { placeholder }) =>
    db.query.itemAnnotations.findMany({
      where: {
        parentItemID: placeholder("parentItemID"),
        item: { deletedItem: false },
      },
      ...legacyAnnotationFindOptions,
    }),
);

const annotationsByKeysQuery = defineKeyedQuery<
  string,
  { libraryID: number }
>()(
  (db, { placeholder, contains }) =>
    db.query.itemAnnotations.findMany({
      where: {
        item: {
          RAW: (item) => contains(item.key),
          libraryID: placeholder("libraryID"),
          deletedItem: false,
        },
      },
      ...annotationFindOptions,
    }),
  { keyOf: (row) => row.item.key },
);

const legacyAnnotationsByKeysQuery = defineKeyedQuery<
  string,
  { libraryID: number }
>()(
  (db, { placeholder, contains }) =>
    db.query.itemAnnotations.findMany({
      where: {
        item: {
          RAW: (item) => contains(item.key),
          libraryID: placeholder("libraryID"),
          deletedItem: false,
        },
      },
      ...legacyAnnotationFindOptions,
    }),
  { keyOf: (row) => row.item.key },
);

type AnnotationRow = QueryRow<typeof annotationsByParentQuery>;

export function getAnnotationsByParent(
  db: NodeDatabaseClient,
  parentItemID: number,
  opts?: { memo?: GroupIDMemo },
): Annotation[] {
  const memo = opts?.memo ?? new Map();
  const rows = readDatabaseLayout(db).has("items", "clientVersion")
    ? annotationsByParentQuery.prepared(db).all({ parentItemID })
    : legacyAnnotationsByParentQuery.prepared(db).all({ parentItemID });
  return rows.map((r) =>
    toAnnotation(r, resolveGroupID(db, r.item.libraryID, memo)),
  );
}

/**
 * Fetch annotations of one library by key, in `keys` order, through
 * one cached keyed read. A key that names no live annotation has no entry; a
 * repeated key repeats its annotation.
 */
export function getAnnotationsByKey(
  db: NodeDatabaseClient,
  keys: readonly string[],
  libraryID: number,
): Annotation[] {
  if (keys.length === 0) return [];

  const groupId = groupIDForLibrary(db, libraryID);
  const byKeys = readDatabaseLayout(db).has("items", "clientVersion")
    ? annotationsByKeysQuery
    : legacyAnnotationsByKeysQuery;
  return byKeys(db, keys, { params: { libraryID } }).flatMap((row) =>
    row.parentAttachment ? [toAnnotation(row, groupId)] : [],
  );
}

function toAnnotation(
  row: AnnotationRow | QueryRow<typeof legacyAnnotationsByParentQuery>,
  groupID: number | null,
): Annotation {
  return {
    itemID: row.itemID,
    key: row.item.key,
    indexedKey: formatIndexedKey(row.item.key, groupID),
    libraryID: row.item.libraryID,
    groupID,
    dateAdded: row.item.dateAdded,
    dateModified: row.item.dateModified,
    version: "clientVersion" in row.item ? row.item.clientVersion : 0,
    type: row.type,
    text: row.text,
    comment: row.comment,
    color: row.color,
    pageLabel: row.pageLabel,
    tags: row.item.itemTags.map((it) => it.tag.name),
    tagDetails: row.item.itemTags.map((it) => ({
      name: it.tag.name,
      type: it.type,
    })),
    sortIndex: row.sortIndex,
    position: row.position,
    authorName: row.authorName,
    isExternal: row.isExternal,
    createdByUserID: row.item.groupItem?.createdByUserID ?? null,
    parentItemID: row.parentItemID,
    parentKey: row.parentAttachment.item_itemID.key,
  };
}
