import { deletedItems, itemAnnotations } from "@drizzle/schema";
import { and, eq, notExists } from "drizzle-orm";

import { type NodeDatabaseClient } from "@/client/node";
import { type AnnotationType } from "@/lib/zt-annot";

import { defineQuery, type QueryRow } from "./_shared";

export interface AnnotViewAttachment {
  itemID: number;
  path: string | null;
  annotCount: number;
}

export interface AnnotViewItem {
  itemID: number;
  key: string;
  type: AnnotationType;
  /** May carry Zotero's inline rich-text tags; see `Annotation.text`. */
  text: string | null;
  comment: string | null;
  color: string | null;
  pageLabel: string | null;
  parentKey: string;
  tags: { tagID: number; name: string }[];
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

function toAnnotViewAttachment(row: AttachmentRow): AnnotViewAttachment {
  return {
    itemID: row.itemID,
    path: row.path,
    annotCount: row.annotCount,
  };
}

export function getAnnotViewAttachments(
  db: NodeDatabaseClient,
  itemKey: string,
  libraryID: number,
): AnnotViewAttachment[] {
  return annotViewAttachmentsQuery
    .prepared(db)
    .all({ key: itemKey, libraryID })
    .map(toAnnotViewAttachment);
}

const annotViewAnnotationsQuery = defineQuery<{ parentItemID: number }>()(
  (db, { placeholder }) =>
    db.query.itemAnnotations.findMany({
      where: {
        parentItemID: placeholder("parentItemID"),
        item: { deletedItem: false },
      },
      columns: {
        itemID: true,
        type: true,
        text: true,
        comment: true,
        color: true,
        pageLabel: true,
      },
      with: {
        item: {
          columns: { key: true },
          with: {
            itemTags: {
              columns: {},
              with: {
                tag: { columns: { tagID: true, name: true } },
              },
            },
          },
        },
        parentAttachment: {
          columns: {},
          with: { item_itemID: { columns: { key: true } } },
        },
      },
      orderBy: { sortIndex: "asc" },
    }),
);

type AnnotationRow = QueryRow<typeof annotViewAnnotationsQuery>;

function toAnnotViewItem(row: AnnotationRow): AnnotViewItem {
  return {
    itemID: row.itemID,
    key: row.item.key,
    type: row.type,
    text: row.text,
    comment: row.comment,
    color: row.color,
    pageLabel: row.pageLabel,
    parentKey: row.parentAttachment.item_itemID.key,
    tags: row.item.itemTags.map((it) => it.tag),
  };
}

export function getAnnotViewAnnotations(
  db: NodeDatabaseClient,
  attachmentItemID: number,
): AnnotViewItem[] {
  return annotViewAnnotationsQuery
    .prepared(db)
    .all({ parentItemID: attachmentItemID })
    .map(toAnnotViewItem);
}
