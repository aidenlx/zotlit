import { type NodeDatabaseClient } from "@/client/node";
import { type SQLocalDatabaseClient } from "@/client/web";
import { type Attachment } from "@/lib/zt-attach";

import {
  groupIDForLibrary,
  resolveGroupID,
  resolveGroupIDAsync,
  type GroupIDMemo,
} from "./_groups";
import { defineQuery, type FindManyOptions, type QueryRow } from "./_shared";

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

type AttachmentRow = QueryRow<typeof attachmentsByParentQuery>;

function toAttachment(row: AttachmentRow, groupID: number | null): Attachment {
  return {
    itemID: row.itemID,
    groupID,
    libraryID: row.item_itemID.libraryID,
    key: row.item_itemID.key,
    parentItemID: row.parentItemID ?? 0,
    path: row.path,
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

export async function getAttachmentsByParentsAsync(
  db: SQLocalDatabaseClient,
  parentItemIDs: readonly number[],
): Promise<Attachment[]> {
  const batches = await Promise.all(
    parentItemIDs.map((parentItemID) =>
      attachmentsByParentQuery.prepared(db).all({ parentItemID }),
    ),
  );
  const rows = batches.flat();
  const memo: GroupIDMemo = new Map();
  await Promise.all(
    [...new Set(rows.map((r) => r.item_itemID.libraryID))].map((libraryID) =>
      resolveGroupIDAsync(db, libraryID, memo),
    ),
  );
  return rows.map((row) =>
    toAttachment(row, memo.get(row.item_itemID.libraryID) ?? null),
  );
}
