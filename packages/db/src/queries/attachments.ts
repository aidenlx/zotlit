import type { NodeDatabaseClient } from "@/client/node";
import type { Attachment } from "@/lib/zt-attach";
import { formatIndexedKey } from "@/lib/zt-key";

import { defineQuery, defineKeyedQuery } from "./_shared";
import type { FindManyOptions, QueryRow } from "./_shared";
import { groupIDForLibrary, resolveGroupID } from "./libraries";
import type { GroupIDMemo } from "./libraries";

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

const attachmentsByParentsQuery = defineKeyedQuery<number>()(
  (db, { contains }) =>
    db.query.itemAttachments.findMany({
      where: {
        RAW: (attachment) => contains(attachment.parentItemID),
        item_itemID: { deletedItem: false },
      },
      ...attachmentFindOptions,
      orderBy: { itemID: "asc" },
    }),
  { keyOf: (row) => row.parentItemID! },
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

const attachmentsByKeysQuery = defineKeyedQuery<
  string,
  { libraryID: number }
>()(
  (db, { placeholder, contains }) =>
    db.query.itemAttachments.findMany({
      where: {
        item_itemID: {
          RAW: (item) => contains(item.key),
          libraryID: placeholder("libraryID"),
          deletedItem: false,
        },
      },
      ...attachmentFindOptions,
    }),
  { keyOf: (row) => row.item_itemID.key },
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

const attachmentPageQuery = defineQuery<{
  afterItemID: number;
  limit: number;
}>()((db, { placeholder }) =>
  db.query.itemAttachments.findMany({
    where: {
      itemID: { gt: placeholder("afterItemID") },
      item_itemID: { deletedItem: false },
    },
    columns: attachmentFindOptions.columns,
    with: {
      ...attachmentFindOptions.with,
      item_parentItemID: { columns: { key: true } },
    },
    orderBy: { itemID: "asc" },
    limit: placeholder("limit"),
  }),
);

type AttachmentRow = QueryRow<typeof attachmentsByParentsQuery>;
type AttachmentWithParentRow = QueryRow<typeof attachmentPageQuery>;

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

/**
 * Fetch the live attachments of each parent item, in `parentItemIDs` order and
 * in `itemID` order within one parent, through one cached keyed read. A parent with
 * no live attachment adds nothing; a repeated parent repeats its attachments.
 */
export function getAttachmentsByParents(
  db: NodeDatabaseClient,
  parentItemIDs: readonly number[],
  opts?: { memo?: GroupIDMemo },
): Attachment[] {
  const memo = opts?.memo ?? new Map();
  return attachmentsByParentsQuery(db, parentItemIDs).map((row) =>
    toAttachment(row, resolveGroupID(db, row.item_itemID.libraryID, memo)),
  );
}

/**
 * Fetch attachments of one library by key, in `keys` order, through
 * one cached keyed read. A key that names no live attachment has no entry; a
 * repeated key repeats its attachment.
 */
export function getAttachmentsByKey(
  db: NodeDatabaseClient,
  libraryID: number,
  keys: readonly string[],
): Attachment[] {
  const rows = attachmentsByKeysQuery(db, keys, { params: { libraryID } });
  if (rows.length === 0) return [];
  const groupID = groupIDForLibrary(db, libraryID);
  return rows.map((row) => toAttachment(row, groupID));
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
 * One page of the live Attachments, each beside its parent Item's Indexed
 * Key — for a consumer that indexes the whole table rather than asking per
 * Item. The attachment path index runs `attachmentAbsPath` across these.
 * Pages run in `itemID` order: the live Attachments after `afterItemID`, at
 * most `limit` of them. Pass the last page's final `itemID` to read the next;
 * an empty page ends the table.
 *
 * @see ../lib/zt-path.ts — `attachmentAbsPath` and `attachmentPathKey`
 */
export function getAttachmentPage(
  db: NodeDatabaseClient,
  page: { afterItemID: number; limit: number },
  opts?: { memo?: GroupIDMemo },
): AttachmentWithParentKey[] {
  const memo = opts?.memo ?? new Map();
  return attachmentPageQuery
    .prepared(db)
    .all(page)
    .map((row) => toAttachmentWithParentKey(db, row, memo));
}

function toAttachmentWithParentKey(
  db: NodeDatabaseClient,
  row: AttachmentWithParentRow,
  memo: GroupIDMemo,
): AttachmentWithParentKey {
  // Zotero keeps a child in its parent's library, so one group lookup covers
  // both keys.
  const groupID = resolveGroupID(db, row.item_itemID.libraryID, memo);
  const parentKey = row.item_parentItemID?.key;
  return {
    ...toAttachment(row, groupID),
    parentIndexedKey:
      parentKey === undefined ? null : formatIndexedKey(parentKey, groupID),
  };
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
