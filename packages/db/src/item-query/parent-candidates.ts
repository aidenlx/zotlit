// Bound Parent Record work to matching parents and their children in one Target Library.
import {
  itemAnnotations,
  itemAttachments,
  items,
  itemTypesCombined,
} from "@drizzle/schema";
import { and, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { Effect } from "effect";

import { readBoundedCandidateSet } from "./candidate-set";
import type { CandidateLeaf } from "./candidate-set";
import { defineStatement, idSlots, unindexed } from "./database";
import type { IdSlot } from "./database";
import { recordUniverse } from "./record-universe";
import { SCAN_PAGE_SIZE } from "./scan-page";

export type ParentCandidateRelation =
  | "attachment-item"
  | "annotation-item"
  | "annotation-attachment";
export type ParentCandidateLeaf =
  | CandidateLeaf
  | { readonly kind: "key"; readonly value: string };

/** A bounded Parent Record read reports whether matches remain unchecked. */
export interface ParentCandidates {
  readonly itemIDs: number[];
  readonly exhausted: boolean;
}

const parent = alias(items, "candidateParent");
const attachment = alias(items, "candidateAttachment");
const slots = idSlots(SCAN_PAGE_SIZE);
const statement = (relation: ParentCandidateRelation) =>
  defineStatement<
    Record<IdSlot, number | null> & { libraryID: number; limit: number }
  >("parent-child-candidate-set")((db, { placeholder: p }) => {
    const fromAttachment = relation === "attachment-item";
    const query = db
      .select({ itemID: items.itemID })
      .from(itemAttachments)
      .innerJoin(attachment, eq(attachment.itemID, itemAttachments.itemID))
      .innerJoin(parent, eq(parent.itemID, itemAttachments.parentItemID))
      .innerJoin(
        itemTypesCombined,
        eq(itemTypesCombined.itemTypeID, parent.itemTypeID),
      )
      .$dynamic();
    if (fromAttachment)
      query.innerJoin(items, eq(items.itemID, itemAttachments.itemID));
    else
      query
        .innerJoin(
          itemAnnotations,
          eq(itemAnnotations.parentItemID, itemAttachments.itemID),
        )
        .innerJoin(items, eq(items.itemID, itemAnnotations.itemID));
    return query
      .where(
        and(
          eq(unindexed(items.libraryID), p("libraryID")),
          inArray(
            relation === "annotation-attachment"
              ? itemAttachments.itemID
              : itemAttachments.parentItemID,
            slots.names.map((name) => p(name)),
          ),
          ...recordUniverse(
            db,
            [items, parent, ...(fromAttachment ? [] : [attachment])],
            fromAttachment,
          ),
        ),
      )
      .limit(p("limit"));
  });
const statements = {
  "attachment-item": statement("attachment-item"),
  "annotation-item": statement("annotation-item"),
  "annotation-attachment": statement("annotation-attachment"),
};

/** Match the leaf before expanding its parents, with a separate bound on each. */
export const readParentCandidateSet = Effect.fnUntraced(function* ({
  relation,
  libraryID,
  leaf,
  limit,
  budget,
}: {
  relation: ParentCandidateRelation;
  libraryID: number;
  leaf: ParentCandidateLeaf;
  limit: number;
  budget: number;
}) {
  const parents = yield* readBoundedCandidateSet({
    libraryID,
    limit: budget + 1,
    leaf: parentItemLeaf(leaf),
  });
  if (parents.length > budget) return { itemIDs: [], exhausted: true };
  const itemIDs: number[] = [];
  const childLimit = Math.min(limit, budget + 1);
  for (let start = 0; start < parents.length; start += SCAN_PAGE_SIZE) {
    const rows = yield* statements[relation].all({
      libraryID,
      limit: childLimit - itemIDs.length,
      ...slots.bind(parents.slice(start, start + SCAN_PAGE_SIZE)),
    });
    itemIDs.push(...rows.map((row) => row.itemID));
    if (itemIDs.length >= childLimit) break;
  }
  return {
    itemIDs,
    exhausted: itemIDs.length > budget,
  } satisfies ParentCandidates;
});

function parentItemLeaf(leaf: ParentCandidateLeaf): CandidateLeaf {
  if (leaf.kind !== "key") return leaf;
  return { kind: "key", key: "key" in leaf ? leaf.key : leaf.value };
}
