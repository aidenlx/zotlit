import { deletedItems, itemAnnotations } from "@drizzle/schema";
import { and, count, eq, notExists } from "drizzle-orm";

import type { NodeDatabaseClient } from "@/client/node";
import { formatIndexedKey } from "@/lib/zt-key";

import { groupIDForLibrary } from "./_groups";
import { defineQuery } from "./_shared";
import type { QueryRow } from "./_shared";

export interface AnnotViewAttachment {
  itemID: number;
  /**
   * The Attachment's Indexed Key — the one identity the view, the reader, and
   * the Zotero Local API share. `itemID` stays adapter data for the read here.
   *
   * @see apps/obsidian/docs/adr/0033-zotero-object-identity-is-the-indexed-key-server-id-is-source-data.md
   */
  indexedKey: string;
  path: string | null;
  annotCount: number;
}

const annotViewAttachmentsQuery = defineQuery<{
  key: string;
  libraryID: number;
}>()((db, { placeholder }) =>
  db.query.itemAttachments.findMany({
    where: {
      item_parentItemID: {
        key: placeholder("key"),
        libraryID: placeholder("libraryID"),
        deletedItem: false,
      },
      item_itemID: { deletedItem: false },
    },
    columns: { itemID: true, path: true },
    with: { item_itemID: { columns: { key: true } } },
    extras: {
      annotCount: (table) =>
        db.$count(
          itemAnnotations,
          and(
            eq(itemAnnotations.parentItemID, table.itemID),
            notExists(
              db
                .select({ _: deletedItems.itemID })
                .from(deletedItems)
                .where(eq(deletedItems.itemID, itemAnnotations.itemID)),
            ),
          ),
        ),
    },
  }),
);

type AttachmentRow = QueryRow<typeof annotViewAttachmentsQuery>;

function toAnnotViewAttachment(
  row: AttachmentRow,
  groupID: number | null,
): AnnotViewAttachment {
  return {
    itemID: row.itemID,
    indexedKey: formatIndexedKey(row.item_itemID.key, groupID),
    path: row.path,
    annotCount: row.annotCount,
  };
}

export function getAnnotViewAttachments(
  db: NodeDatabaseClient,
  itemKey: string,
  libraryID: number,
): AnnotViewAttachment[] {
  const groupID = groupIDForLibrary(db, libraryID);
  return annotViewAttachmentsQuery
    .prepared(db)
    .all({ key: itemKey, libraryID })
    .map((row) => toAnnotViewAttachment(row, groupID));
}

const annotationCountQuery = defineQuery<{ parentItemID: number }>()(
  (db, { placeholder }) =>
    db
      .select({ count: count() })
      .from(itemAnnotations)
      .where(
        and(
          eq(itemAnnotations.parentItemID, placeholder("parentItemID")),
          notExists(
            db
              .select({ _: deletedItems.itemID })
              .from(deletedItems)
              .where(eq(deletedItems.itemID, itemAnnotations.itemID)),
          ),
        ),
      ),
);

/**
 * How many live Annotations one Attachment holds, for the label the attachment
 * picker shows. The Annotations themselves are read through the annotation
 * repository, which answers from whichever Annotation Source is active rather
 * than from SQLite alone.
 *
 * @see apps/obsidian/docs/adr/0034-the-annotation-source-is-atomic-per-attachment.md
 */
export function getAttachmentAnnotationCount(
  db: NodeDatabaseClient,
  attachmentItemID: number,
): number {
  const row = annotationCountQuery
    .prepared(db)
    .get({ parentItemID: attachmentItemID });
  return row?.count ?? 0;
}
