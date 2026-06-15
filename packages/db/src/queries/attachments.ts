import { type NodeDatabaseClient } from "@/client/node";
import { type SQLocalDatabaseClient } from "@/client/web";
import { type Attachment } from "@/lib/zt-attach";

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

const attachmentsByParentQuery = defineQuery<{
  parentItemID: number;
  libraryID: number;
}>()((db, { placeholder }) =>
  db.query.itemAttachments.findMany({
    where: {
      parentItemID: placeholder("parentItemID"),
      item_itemID: {
        libraryID: placeholder("libraryID"),
        deletedItem: false,
      },
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

type AttachmentRow = QueryRow<typeof attachmentsByParentQuery>;

function toAttachment(row: AttachmentRow): Attachment {
  return {
    itemID: row.itemID,
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
  libraryID: number,
): Attachment[] {
  const stmt = attachmentsByParentQuery.prepared(db);
  return parentItemIDs.flatMap((parentItemID) =>
    stmt.all({ parentItemID, libraryID }).map(toAttachment),
  );
}

export function getAttachmentByKey(
  db: NodeDatabaseClient,
  key: string,
  libraryID: number,
): Attachment | null {
  const row = attachmentByKeyQuery.prepared(db).all({ libraryID, key })[0];
  return row ? toAttachment(row) : null;
}

export async function getAttachmentsByParentsAsync(
  db: SQLocalDatabaseClient,
  parentItemIDs: readonly number[],
  libraryID: number,
): Promise<Attachment[]> {
  const stmt = attachmentsByParentQuery.prepared(db);
  const batches = await Promise.all(
    parentItemIDs.map((parentItemID) => stmt.all({ parentItemID, libraryID })),
  );
  return batches.flatMap((rows) => rows.map(toAttachment));
}
