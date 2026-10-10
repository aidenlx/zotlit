import {
  deletedItems,
  itemAnnotations,
  itemAttachments,
  items,
  itemTypesCombined,
} from "@drizzle/schema";
import { and, eq, gt, inArray, notExists, notInArray } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { Effect } from "effect";

import { CHILD_ITEM_TYPES } from "@/lib/item-types";

import { defineStatement, idSlots, unindexed } from "./database";
import type { IdSlot } from "./database";
import { SCAN_PAGE_SIZE } from "./scan-page";

export type CandidateRelation =
  | "item-attachments"
  | "item-annotations"
  | "attachment-annotations"
  | "attachment-item"
  | "annotation-item"
  | "annotation-attachment";
const attachment = alias(items, "relationAttachment");
const parent = alias(items, "relationParent");
const slots = idSlots(SCAN_PAGE_SIZE);

const statement = (relation: CandidateRelation) =>
  defineStatement<
    Record<IdSlot, number | null> & {
      libraryID: number;
      afterItemID: number;
      limit: number;
    }
  >("relation-candidate-set")((db, { placeholder: p }) => {
    const fromAttachment =
      relation === "item-attachments" || relation === "attachment-item";
    const reversed =
      relation === "attachment-item" ||
      relation === "annotation-item" ||
      relation === "annotation-attachment";
    const child = fromAttachment ? attachment : items;
    const ancestor =
      relation === "attachment-annotations" ||
      relation === "annotation-attachment"
        ? attachment
        : parent;
    const element = reversed ? ancestor : child;
    const target = reversed ? child : ancestor;
    const query = db
      .selectDistinct({ itemID: target.itemID })
      .from(itemAttachments)
      .innerJoin(attachment, eq(attachment.itemID, itemAttachments.itemID))
      .innerJoin(parent, eq(parent.itemID, itemAttachments.parentItemID))
      .innerJoin(
        itemTypesCombined,
        eq(itemTypesCombined.itemTypeID, parent.itemTypeID),
      )
      .$dynamic();
    if (!fromAttachment)
      query
        .innerJoin(
          itemAnnotations,
          eq(itemAnnotations.parentItemID, attachment.itemID),
        )
        .innerJoin(items, eq(items.itemID, itemAnnotations.itemID));
    return query
      .where(
        and(
          eq(unindexed(element.libraryID), p("libraryID")),
          gt(target.itemID, p("afterItemID")),
          inArray(
            element.itemID,
            slots.names.map((name) => p(name)),
          ),
          notInArray(itemTypesCombined.typeName, [...CHILD_ITEM_TYPES]),
          ...(fromAttachment
            ? [inArray(itemAttachments.linkMode, [0, 1, 2, 3])]
            : []),
          ...[attachment, parent, ...(fromAttachment ? [] : [items])].map(
            (table) =>
              notExists(
                db
                  .select({ itemID: deletedItems.itemID })
                  .from(deletedItems)
                  .where(eq(deletedItems.itemID, table.itemID)),
              ),
          ),
        ),
      )
      .orderBy(target.itemID)
      .limit(p("limit"));
  });
const statements = {
  "attachment-item": statement("attachment-item"),
  "annotation-item": statement("annotation-item"),
  "annotation-attachment": statement("annotation-attachment"),
  "item-attachments": statement("item-attachments"),
  "item-annotations": statement("item-annotations"),
  "attachment-annotations": statement("attachment-annotations"),
};

/** Map at most 500 related IDs to a page of distinct records in the relation universe. */
export function readRelationCandidateSet(chunk: {
  relation: CandidateRelation;
  libraryID: number;
  itemIDs: readonly number[];
  afterItemID?: number;
  limit?: number;
}) {
  if (chunk.itemIDs.length > SCAN_PAGE_SIZE)
    return Effect.die(
      new RangeError("A relation candidate chunk holds at most 500 IDs."),
    );
  if (!chunk.itemIDs.length) return Effect.succeed([] as number[]);
  return Effect.map(
    statements[chunk.relation].all({
      libraryID: chunk.libraryID,
      afterItemID: chunk.afterItemID ?? 0,
      limit: Math.min(chunk.limit ?? SCAN_PAGE_SIZE, SCAN_PAGE_SIZE),
      ...slots.bind(chunk.itemIDs),
    }),
    (rows) => rows.map((row) => row.itemID),
  );
}
