import type { NodeDatabaseClient } from "@/client/node";
import type { Annotation } from "@/lib/zt-annot";
import { formatIndexedKey } from "@/lib/zt-key";

import { groupIDForLibrary, resolveGroupID } from "./_groups";
import type { GroupIDMemo } from "./_groups";
import { defineQuery, idSlots, rowsByID } from "./_shared";
import type { FindManyOptions, QueryRow, SlotParams } from "./_shared";
import { hasClientRevisions } from "./schema-version";

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

const annotationsByKeysQuery = defineQuery<
  { libraryID: number } & SlotParams<string>
>()((db, { placeholder }) =>
  db.query.itemAnnotations.findMany({
    where: {
      item: {
        key: { in: idSlots(placeholder) },
        libraryID: placeholder("libraryID"),
        deletedItem: false,
      },
    },
    ...annotationFindOptions,
  }),
);

const legacyAnnotationsByKeysQuery = defineQuery<
  { libraryID: number } & SlotParams<string>
>()((db, { placeholder }) =>
  db.query.itemAnnotations.findMany({
    where: {
      item: {
        key: { in: idSlots(placeholder) },
        libraryID: placeholder("libraryID"),
        deletedItem: false,
      },
    },
    ...legacyAnnotationFindOptions,
  }),
);

type AnnotationRow = QueryRow<typeof annotationsByParentQuery>;

export function getAnnotationsByParent(
  db: NodeDatabaseClient,
  parentItemID: number,
  opts?: { memo?: GroupIDMemo },
): Annotation[] {
  const memo = opts?.memo ?? new Map();
  const rows = hasClientRevisions(db)
    ? annotationsByParentQuery.prepared(db).all({ parentItemID })
    : legacyAnnotationsByParentQuery.prepared(db).all({ parentItemID });
  return rows.map((r) =>
    toAnnotation(r, resolveGroupID(db, r.item.libraryID, memo)),
  );
}

/**
 * Fetch annotations of one library by key, in `keys` order, through
 * {@link rowsByID}. A key that names no live annotation has no entry; a
 * repeated key repeats its annotation.
 */
export function getAnnotationsByKey(
  db: NodeDatabaseClient,
  keys: readonly string[],
  libraryID: number,
): Annotation[] {
  if (keys.length === 0) return [];

  const groupId = groupIDForLibrary(db, libraryID);
  const byKeys = hasClientRevisions(db)
    ? annotationsByKeysQuery
    : legacyAnnotationsByKeysQuery;
  return rowsByID(keys, {
    batch: (slots) => byKeys.prepared(db).all({ libraryID, ...slots }),
    idOf: (row) => row.item.key,
  }).flatMap((row) =>
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
