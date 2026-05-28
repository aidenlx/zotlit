import { type NodeDatabaseClient } from "@/client/node";
import { type SQLocalDatabaseClient } from "@/client/web";
import { type Attachment } from "@/lib/zt-attach";

import { defineQuery, type QueryRow } from "./_shared";

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
    columns: {
      itemID: true,
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
  }),
);

type AttachmentRow = QueryRow<typeof attachmentsByParentQuery>;

function toAttachment(row: AttachmentRow, parentItemID: number): Attachment {
  return {
    itemID: row.itemID,
    libraryID: row.item_itemID.libraryID,
    key: row.item_itemID.key,
    parentItemID,
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
    stmt
      .all({ parentItemID, libraryID })
      .map((row) => toAttachment(row, parentItemID)),
  );
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
  return batches.flatMap((rows, i) =>
    rows.map((row) => toAttachment(row, parentItemIDs[i]!)),
  );
}
