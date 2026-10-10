import {
  collectionItems,
  deletedItems,
  itemAnnotations,
  itemAttachments,
  itemData,
  itemDataValues,
  items,
  itemTags,
  itemTypesCombined,
  tags,
} from "@drizzle/schema";
import {
  and,
  eq,
  exists,
  isNotNull,
  inArray,
  notExists,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { Effect } from "effect";

import { CHILD_ITEM_TYPES } from "@/lib/item-types";

import type { CandidateLeaf } from "./candidate-set";
import { storedIntegerOf, storedNumberOf } from "./candidate-set";
import { defineStatement, unindexed } from "./database";

export type ParentCandidateRelation =
  | "attachment-item"
  | "annotation-item"
  | "annotation-attachment";

/** A bounded Parent Record read reports whether unexamined children remain. */
export interface ParentCandidates {
  readonly itemIDs: number[];
  readonly exhausted: boolean;
}

interface Params extends Record<string, unknown> {
  libraryID: number;
  budget: number;
  windowLimit: number;
  limit: number;
  value: string;
  list: string;
  number: number | null;
  integer: bigint | null;
}

const parent = alias(items, "candidateParent");
const attachment = alias(items, "candidateAttachment");

const statement = (
  relation: ParentCandidateRelation,
  kind: CandidateLeaf["kind"],
) =>
  defineStatement<Params>(
    relation === "attachment-item"
      ? "attachment-candidate-set"
      : "annotation-candidate-set",
  )((db, { placeholder: p }) => {
    const child =
      relation === "attachment-item" ? itemAttachments : itemAnnotations;
    // LIMIT precedes the Parent Record predicate. Even a dominant or absent
    // parent leaf checks at most the child budget plus one in this statement.
    const page = db
      .$with("candidatePage")
      .as(
        db
          .select({ itemID: child.itemID, parentItemID: child.parentItemID })
          .from(child)
          .orderBy(child.itemID)
          .limit(p("windowLimit")),
      );
    const target = relation === "annotation-attachment" ? attachment : parent;
    const list = sql`select value from json_each(${p("list")})`;
    const condition = {
      tag: exists(
        db
          .select({ itemID: itemTags.itemID })
          .from(itemTags)
          .where(
            and(
              eq(itemTags.itemID, target.itemID),
              eq(
                itemTags.tagID,
                db
                  .select({ tagID: tags.tagID })
                  .from(tags)
                  .where(eq(tags.name, p("value"))),
              ),
            ),
          ),
      ),
      key: eq(target.key, p("value")),
      keys: sql`${target.key} in (${list})`,
      field: exists(
        db
          .select({ itemID: itemData.itemID })
          .from(itemData)
          .innerJoin(
            itemDataValues,
            eq(itemDataValues.valueID, itemData.valueID),
          )
          .where(
            and(
              eq(itemData.itemID, target.itemID),
              sql`${unindexed(itemData.fieldID)} in (${list})`,
              or(
                eq(itemDataValues.value, p("value")),
                eq(itemDataValues.value, p("number")),
                eq(itemDataValues.value, p("integer")),
              ),
            ),
          ),
      ),
      collection: exists(
        db
          .select({ itemID: collectionItems.itemID })
          .from(collectionItems)
          .where(
            and(
              eq(collectionItems.itemID, target.itemID),
              sql`${collectionItems.collectionID} in (${list})`,
            ),
          ),
      ),
    }[kind];
    const matches = and(
      eq(unindexed(items.libraryID), p("libraryID")),
      condition,
      notInArray(itemTypesCombined.typeName, [...CHILD_ITEM_TYPES]),
      ...(relation === "attachment-item"
        ? [inArray(itemAttachments.linkMode, [0, 1, 2, 3])]
        : []),
      ...[
        items,
        parent,
        ...(relation === "attachment-item" ? [] : [attachment]),
      ].map((table) =>
        notExists(
          db
            .select({ itemID: deletedItems.itemID })
            .from(deletedItems)
            .where(eq(deletedItems.itemID, table.itemID)),
        ),
      ),
    );
    // The child window includes other Libraries, standalone and trashed rows.
    // Filter after bounding the input, so rejected rows cannot extend the work.
    const candidates = db
      .select({ itemID: page.itemID })
      .from(page)
      .innerJoin(items, eq(items.itemID, page.itemID))
      .leftJoin(
        itemAttachments,
        eq(
          itemAttachments.itemID,
          relation === "attachment-item" ? page.itemID : page.parentItemID,
        ),
      )
      .leftJoin(attachment, eq(attachment.itemID, itemAttachments.itemID))
      .leftJoin(parent, eq(parent.itemID, itemAttachments.parentItemID))
      .leftJoin(
        itemTypesCombined,
        eq(itemTypesCombined.itemTypeID, parent.itemTypeID),
      )
      .where(matches)
      .orderBy(page.itemID)
      .limit(p("limit"))
      .as("candidateMatches");
    const exhausted = sql<number>`(select count(*) from ${page}) > ${p("budget")}`;
    // Preserve an exhausted outcome even when this window has no matches.
    return db
      .with(page)
      .select({ itemID: candidates.itemID, exhausted })
      .from(sql`(select 1)`)
      .leftJoin(candidates, sql`true`)
      .where(or(isNotNull(candidates.itemID), exhausted))
      .orderBy(candidates.itemID);
  });

const statements = Object.fromEntries(
  (
    ["attachment-item", "annotation-item", "annotation-attachment"] as const
  ).map((relation) => [
    relation,
    Object.fromEntries(
      (["tag", "key", "keys", "field", "collection"] as const).map((kind) => [
        kind,
        statement(relation, kind),
      ]),
    ),
  ]),
);

/** Check a Parent Record leaf against a bounded child window in a Target Library. */
export function readParentCandidateSet({
  relation,
  libraryID,
  leaf,
  limit,
  budget,
}: {
  relation: ParentCandidateRelation;
  libraryID: number;
  leaf: CandidateLeaf;
  limit: number;
  budget: number;
}) {
  const value =
    leaf.kind === "key"
      ? leaf.key
      : leaf.kind === "tag" || leaf.kind === "field"
        ? leaf.value
        : "";
  const list =
    leaf.kind === "keys"
      ? leaf.keys
      : leaf.kind === "field"
        ? leaf.fieldIDs
        : leaf.kind === "collection"
          ? leaf.collectionIDs
          : [];
  return Effect.map(
    statements[relation]![leaf.kind]!.all({
      libraryID,
      budget,
      windowLimit: budget + 1,
      limit,
      value,
      list: JSON.stringify(list),
      number: storedNumberOf(value),
      integer: storedIntegerOf(value),
    }),
    (rows) =>
      ({
        itemIDs: rows.flatMap((row) =>
          row.itemID === null ? [] : [row.itemID],
        ),
        exhausted: rows.some((row) => row.exhausted === 1),
      }) satisfies ParentCandidates,
  );
}
