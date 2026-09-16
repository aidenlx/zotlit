import type { NodeDatabaseClient } from "@/client/node";
import type { Attachment } from "@/lib/zt-attach";
import { formatIndexedKey } from "@/lib/zt-key";

import { groupIDForLibrary, resolveGroupID } from "./_groups";
import type { GroupIDMemo } from "./_groups";
import { defineQuery } from "./_shared";
import type { FindManyOptions, QueryRow } from "./_shared";

const attachmentFindOptions = {
  columns: {
    itemID: true,
    parentItemID: true,
    path: true,
    contentType: true,
    linkMode: true,
  },
  with: {
    item_itemID: {
      columns: {
        key: true,
        libraryID: true,
        dateAdded: true,
        dateModified: true,
      },
      with: {
        itemData: {
          columns: {},
          where: { fieldsCombined: { fieldName: "url" } },
          with: {
            itemDataValue: { columns: { value: true } },
          },
        },
      },
    },
  },
} satisfies FindManyOptions<"itemAttachments">;

const attachmentsByParentQuery = defineQuery<{ parentItemID: number }>()(
  (db, { placeholder }) =>
    db.query.itemAttachments.findMany({
      where: {
        parentItemID: placeholder("parentItemID"),
        item_itemID: { deletedItem: false },
      },
      ...attachmentFindOptions,
    }),
);

const attachmentByKeyQuery = defineQuery<{
  libraryID: number;
  key: string;
}>()((db, { placeholder }) =>
  db.query.itemAttachments.findMany({
    where: {
      item_itemID: {
        key: placeholder("key"),
        libraryID: placeholder("libraryID"),
        deletedItem: false,
      },
    },
    ...attachmentFindOptions,
  }),
);

const attachmentByItemIdQuery = defineQuery<{ itemID: number }>()(
  (db, { placeholder }) =>
    db.query.itemAttachments.findMany({
      where: {
        itemID: placeholder("itemID"),
        item_itemID: { deletedItem: false },
      },
      ...attachmentFindOptions,
    }),
);

const allAttachmentsQuery = defineQuery<void>()((db) =>
  db.query.itemAttachments.findMany({
    where: { item_itemID: { deletedItem: false } },
    columns: attachmentFindOptions.columns,
    with: {
      ...attachmentFindOptions.with,
      item_parentItemID: { columns: { key: true } },
    },
  }),
);

type AttachmentRow = QueryRow<typeof attachmentsByParentQuery>;

function toAttachment(row: AttachmentRow, groupID: number | null): Attachment {
  const path =
    row.linkMode === 3
      ? (row.item_itemID.itemData[0]?.itemDataValue?.value ?? null)
      : row.path;
  return {
    itemID: row.itemID,
    groupID,
    libraryID: row.item_itemID.libraryID,
    key: row.item_itemID.key,
    indexedKey: formatIndexedKey(row.item_itemID.key, groupID),
    parentItemID: row.parentItemID ?? 0,
    path,
    contentType: row.contentType,
    linkMode: row.linkMode,
    dateAdded: row.item_itemID.dateAdded,
    dateModified: row.item_itemID.dateModified,
  };
}

export function getAttachmentsByParents(
  db: NodeDatabaseClient,
  parentItemIDs: readonly number[],
  opts?: { memo?: GroupIDMemo },
): Attachment[] {
  const memo = opts?.memo ?? new Map();
  return parentItemIDs.flatMap((parentItemID) =>
    attachmentsByParentQuery
      .prepared(db)
      .all({ parentItemID })
      .map((row) =>
        toAttachment(row, resolveGroupID(db, row.item_itemID.libraryID, memo)),
      ),
  );
}

export function getAttachmentByKey(
  db: NodeDatabaseClient,
  key: string,
  libraryID: number,
): Attachment | null {
  const row = attachmentByKeyQuery.prepared(db).all({ libraryID, key })[0];
  if (!row) return null;
  return toAttachment(row, groupIDForLibrary(db, libraryID));
}

export interface AttachmentWithParentKey extends Attachment {
  /**
   * Indexed Key of the Item this Attachment hangs from; `null` for a standalone
   * Attachment, which Zotero allows and which holds Annotations like any other.
   */
  parentIndexedKey: string | null;
}

/**
 * Every live Attachment, each beside its parent Item's Indexed Key — for a
 * consumer that indexes the whole table rather than asking per Item. The
 * attachment path index runs `attachmentAbsPath` across this.
 *
 * @see ../lib/zt-path.ts — `attachmentAbsPath` and `attachmentPathKey`
 */
export function getAllAttachments(
  db: NodeDatabaseClient,
): AttachmentWithParentKey[] {
  const memo: GroupIDMemo = new Map();
  return allAttachmentsQuery
    .prepared(db)
    .all()
    .map((row) => {
      // Zotero keeps a child in its parent's library, so one group lookup
      // covers both keys.
      const groupID = resolveGroupID(db, row.item_itemID.libraryID, memo);
      const parentKey = row.item_parentItemID?.key;
      return {
        ...toAttachment(row, groupID),
        parentIndexedKey:
          parentKey === undefined ? null : formatIndexedKey(parentKey, groupID),
      };
    });
}

export function getAttachmentByItemId(
  db: NodeDatabaseClient,
  itemID: number,
  opts?: { memo?: GroupIDMemo },
): Attachment | null {
  const row = attachmentByItemIdQuery.prepared(db).all({ itemID })[0];
  if (!row) return null;
  const memo = opts?.memo ?? new Map();
  return toAttachment(row, resolveGroupID(db, row.item_itemID.libraryID, memo));
}
