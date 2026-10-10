import {
  itemAnnotations,
  itemAttachments,
  items,
  itemTypesCombined,
} from "@drizzle/schema";
import { and, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { Effect } from "effect";

import { defineStatement, idSlots, unindexed } from "./database";
import type { IdSlot } from "./database";
import { recordUniverse } from "./record-universe";
import { SCAN_PAGE_SIZE } from "./scan-page";

export type CandidateRelation =
  | "item-attachments"
  | "item-annotations"
  | "attachment-annotations";
const attachment = alias(items, "relationAttachment");
const parent = alias(items, "relationParent");
const slots = idSlots(SCAN_PAGE_SIZE);

const statement = (relation: CandidateRelation) =>
  defineStatement<Record<IdSlot, number | null> & { libraryID: number }>(
    "relation-candidate-set",
  )((db, { placeholder: p }) => {
    const fromAttachment = relation === "item-attachments";
    const element = fromAttachment ? attachment : items;
    const query = db
      .selectDistinct({
        itemID:
          relation === "attachment-annotations"
            ? attachment.itemID
            : parent.itemID,
      })
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
    return query.where(
      and(
        eq(unindexed(element.libraryID), p("libraryID")),
        inArray(
          element.itemID,
          slots.names.map((name) => p(name)),
        ),
        ...recordUniverse(
          db,
          [attachment, parent, ...(fromAttachment ? [] : [items])],
          fromAttachment,
        ),
      ),
    );
  });
const statements = {
  "item-attachments": statement("item-attachments"),
  "item-annotations": statement("item-annotations"),
  "attachment-annotations": statement("attachment-annotations"),
};

/** Map at most 500 element IDs to distinct parents in the Relation List universe. */
export function readRelationCandidateSet(chunk: {
  relation: CandidateRelation;
  libraryID: number;
  itemIDs: readonly number[];
}) {
  if (chunk.itemIDs.length > SCAN_PAGE_SIZE)
    return Effect.die(
      new RangeError("A relation candidate chunk holds at most 500 IDs."),
    );
  if (!chunk.itemIDs.length) return Effect.succeed([] as number[]);
  return Effect.map(
    statements[chunk.relation].all({
      libraryID: chunk.libraryID,
      ...slots.bind(chunk.itemIDs),
    }),
    (rows) => rows.map((row) => row.itemID),
  );
}
