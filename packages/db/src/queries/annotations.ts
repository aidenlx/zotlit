import { type NodeDatabaseClient } from "@/client/node";
import { type Annotation } from "@/lib/zt-annot";
import { formatIndexedKey } from "@/lib/zt-key";

import { groupIDForLibrary, resolveGroupID, type GroupIDMemo } from "./_groups";
import { defineQuery, type FindManyOptions, type QueryRow } from "./_shared";

const annotationFindOptions = {
  with: {
    item: {
      columns: {
        key: true,
        libraryID: true,
        dateAdded: true,
        dateModified: true,
      },
    },
    parentAttachment: {
      columns: {},
      with: { item_itemID: { columns: { key: true } } },
    },
  },
  orderBy: { sortIndex: "asc" },
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

const annotationsByKeyQuery = defineQuery<{
  libraryID: number;
  key: string;
}>()((db, { placeholder }) =>
  db.query.itemAnnotations.findMany({
    where: {
      item: {
        key: placeholder("key"),
        libraryID: placeholder("libraryID"),
        deletedItem: false,
      },
    },
    ...annotationFindOptions,
  }),
);

const annotationByItemIdQuery = defineQuery<{ itemID: number }>()(
  (db, { placeholder }) =>
    db.query.itemAnnotations.findMany({
      where: { itemID: placeholder("itemID"), item: { deletedItem: false } },
      ...annotationFindOptions,
    }),
);

type AnnotationRow = QueryRow<typeof annotationsByParentQuery>;

export function getAnnotationsByParent(
  db: NodeDatabaseClient,
  parentItemID: number,
  opts?: { memo?: GroupIDMemo },
): Annotation[] {
  const memo = opts?.memo ?? new Map();
  return annotationsByParentQuery
    .prepared(db)
    .all({ parentItemID })
    .map((r) => toAnnotation(r, resolveGroupID(db, r.item.libraryID, memo)));
}

export function getAnnotationsByKey(
  db: NodeDatabaseClient,
  keys: readonly string[],
  libraryID: number,
): Annotation[] {
  if (keys.length === 0) return [];

  const groupId = groupIDForLibrary(db, libraryID);
  return keys.flatMap((key) =>
    annotationsByKeyQuery
      .prepared(db)
      .all({ libraryID, key })
      .flatMap((row) =>
        row.parentAttachment ? [toAnnotation(row, groupId)] : [],
      ),
  );
}

export function getAnnotationsByItemId(
  db: NodeDatabaseClient,
  itemIDs: number[],
  opts?: { memo?: GroupIDMemo },
): Annotation[] {
  const memo = opts?.memo ?? new Map();
  return itemIDs.flatMap((itemID) =>
    annotationByItemIdQuery
      .prepared(db)
      .all({ itemID })
      .map((r) => toAnnotation(r, resolveGroupID(db, r.item.libraryID, memo))),
  );
}

function toAnnotation(row: AnnotationRow, groupID: number | null): Annotation {
  return {
    itemID: row.itemID,
    key: row.item.key,
    indexedKey: formatIndexedKey(row.item.key, groupID),
    libraryID: row.item.libraryID,
    groupID,
    dateAdded: row.item.dateAdded,
    dateModified: row.item.dateModified,
    type: row.type,
    text: row.text,
    comment: row.comment,
    color: row.color,
    pageLabel: row.pageLabel,
    sortIndex: row.sortIndex,
    position: row.position,
    authorName: row.authorName,
    isExternal: row.isExternal,
    parentItemID: row.parentItemID,
    parentKey: row.parentAttachment.item_itemID.key,
  };
}
