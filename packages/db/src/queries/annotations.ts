import { type NodeDatabaseClient } from "@/client/node";
import { type SQLocalDatabaseClient } from "@/client/web";
import { annotationTypeFromID, type Annotation } from "@/lib/zt-annot";

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

const annotationsByParentQuery = defineQuery<{
  parentItemID: number;
  libraryID: number;
}>()((db, { placeholder }) =>
  db.query.itemAnnotations.findMany({
    where: {
      parentItemID: placeholder("parentItemID"),
      item: {
        libraryID: placeholder("libraryID"),
        deletedItem: false,
      },
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

type AnnotationRow = QueryRow<typeof annotationsByParentQuery>;

export function getAnnotationsByParent(
  db: NodeDatabaseClient,
  parentItemID: number,
  libraryID: number,
): Annotation[] {
  return annotationsByParentQuery
    .prepared(db)
    .all({ parentItemID, libraryID })
    .map(toAnnotation);
}

export async function getAnnotationsByParentAsync(
  db: SQLocalDatabaseClient,
  parentItemID: number,
  libraryID: number,
): Promise<Annotation[]> {
  const rows = await annotationsByParentQuery
    .prepared(db)
    .all({ parentItemID, libraryID });
  return rows.map(toAnnotation);
}

export function getAnnotationsByKey(
  db: NodeDatabaseClient,
  keys: readonly string[],
  libraryID: number,
): Annotation[] {
  if (keys.length === 0) return [];

  const stmt = annotationsByKeyQuery.prepared(db);
  return keys.flatMap((key) => stmt.all({ libraryID, key }).map(toAnnotation));
}

export async function getAnnotationsByKeyAsync(
  db: SQLocalDatabaseClient,
  keys: readonly string[],
  libraryID: number,
): Promise<Annotation[]> {
  if (keys.length === 0) return [];

  const stmt = annotationsByKeyQuery.prepared(db);
  const batches = await Promise.all(
    keys.map((key) => stmt.all({ libraryID, key })),
  );
  return batches.flat().map(toAnnotation);
}

function toAnnotation(row: AnnotationRow): Annotation {
  return {
    itemID: row.itemID,
    key: row.item.key,
    libraryID: row.item.libraryID,
    dateAdded: row.item.dateAdded,
    dateModified: row.item.dateModified,
    type: annotationTypeFromID(row.type, row.item.key),
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
