import {
  collectionItems,
  itemData,
  itemDataValues,
  items,
  itemTags,
  tags,
} from "@drizzle/schema";
import { and, count, eq, gt, or, sql } from "drizzle-orm";
import { Effect } from "effect";

import type { TagCandidateLeaf, KeysCandidateLeaf } from "./candidate-leaf";
import { defineStatement, unindexed } from "./database";
import type { ItemQueryDatabase, ItemQueryReaderError } from "./database";

const libraryRowCountStatement = defineStatement<{ libraryID: number }>(
  "library-row-count",
)((db, { placeholder }) =>
  db
    .select({ rows: count() })
    .from(items)
    .where(eq(items.libraryID, placeholder("libraryID"))),
);

/**
 * Count the `items` rows of one Library: top-level, child, and trashed rows
 * alike. The candidate cap of a query is a share of this count.
 */
export function readLibraryRowCount(
  libraryID: number,
): Effect.Effect<number, ItemQueryReaderError, ItemQueryDatabase> {
  return Effect.map(
    libraryRowCountStatement.all({ libraryID }),
    (rows) => rows[0]?.rows ?? 0,
  );
}

/**
 * One leaf of a Filter Expression that Zotero's own indexes answer. Each kind
 * has one statement in {@link readCandidateSet}.
 */
export type CandidateLeaf =
  /** The Items that carry the Tag with this exact name. */
  | TagCandidateLeaf
  /** The Item with this Zotero Key. */
  | { readonly kind: "key"; readonly key: string }
  | KeysCandidateLeaf
  /**
   * The Items that store this exact value in one of these fields. Give every
   * field ID of a built-in field and its aliases (`FieldVocabulary.fieldIDsOf`).
   * The value matches a stored text and a stored number that reads as it.
   */
  | {
      readonly kind: "field";
      readonly fieldIDs: readonly number[];
      readonly value: string;
    }
  /** The Items filed directly in one of these Collections. */
  | { readonly kind: "collection"; readonly collectionIDs: readonly number[] };

interface CandidateParams extends Record<string, unknown> {
  libraryID: number;
  limit: number;
  afterItemID: number;
}

interface ValueParams extends CandidateParams {
  value: string;
}

interface FieldParams extends ValueParams {
  /** The field IDs as a JSON array. */
  fieldIDs: string;
  /** The REAL value that reads as `value`, or null. */
  number: number | null;
  /** The exact INTEGER value that reads as `value`, or null. */
  integer: bigint | null;
}

interface CollectionParams extends CandidateParams {
  /** The Collection IDs as a JSON array. */
  collectionIDs: string;
}

const candidateStatements = {
  keys: defineStatement<ValueParams>("candidate-set")((db, { placeholder }) =>
    db
      .select({ itemID: items.itemID })
      .from(items)
      .where(
        and(
          gt(items.itemID, placeholder("afterItemID")),
          sql`${items.itemID} in (${db
            .select({ itemID: items.itemID })
            .from(items)
            .where(
              and(
                eq(items.libraryID, placeholder("libraryID")),
                sql`${items.key} in (select value from json_each(${placeholder("value")}))`,
              ),
            )})`,
        ),
      )
      .orderBy(items.itemID)
      .limit(placeholder("limit")),
  ),
  tag: defineStatement<ValueParams>("candidate-set")((db, { placeholder }) =>
    db
      .select({ itemID: itemTags.itemID })
      .from(itemTags)
      .innerJoin(items, eq(items.itemID, itemTags.itemID))
      .where(
        and(
          // The tagID index orders by rowid; the primary key orders by Item ID.
          eq(
            unindexed(itemTags.tagID),
            db
              .select({ tagID: tags.tagID })
              .from(tags)
              .where(eq(tags.name, placeholder("value"))),
          ),
          eq(unindexed(items.libraryID), placeholder("libraryID")),
          gt(itemTags.itemID, placeholder("afterItemID")),
        ),
      )
      .orderBy(itemTags.itemID)
      .limit(placeholder("limit")),
  ),
  key: defineStatement<ValueParams>("candidate-set")((db, { placeholder }) =>
    db
      .select({ itemID: items.itemID })
      .from(items)
      .where(
        and(
          eq(items.libraryID, placeholder("libraryID")),
          gt(items.itemID, placeholder("afterItemID")),
          eq(items.key, placeholder("value")),
        ),
      )
      .orderBy(items.itemID)
      .limit(placeholder("limit")),
  ),
  field: defineStatement<FieldParams>("candidate-set")((db, { placeholder }) =>
    db
      .selectDistinct({ itemID: sql<number>`${itemData.itemID}` })
      .from(itemData)
      .innerJoin(items, eq(items.itemID, itemData.itemID))
      .where(
        and(
          // Walk the (itemID, fieldID) primary key in page order. The value
          // index supplies the small set of value IDs, without sorting matches.
          sql`${unindexed(itemData.valueID)} in (${db
            .select({ valueID: itemDataValues.valueID })
            .from(itemDataValues)
            .where(
              or(
                eq(itemDataValues.value, placeholder("value")),
                eq(itemDataValues.value, placeholder("number")),
                eq(itemDataValues.value, placeholder("integer")),
              ),
            )})`,
          sql`${unindexed(itemData.fieldID)} in (select value from json_each(${placeholder("fieldIDs")}))`,
          eq(unindexed(items.libraryID), placeholder("libraryID")),
          gt(itemData.itemID, placeholder("afterItemID")),
        ),
      )
      .orderBy(itemData.itemID)
      .limit(placeholder("limit")),
  ),
  collection: defineStatement<CollectionParams>("candidate-set")(
    (db, { placeholder }) =>
      db
        .selectDistinct({ itemID: collectionItems.itemID })
        .from(collectionItems)
        .innerJoin(items, eq(items.itemID, collectionItems.itemID))
        .where(
          and(
            sql`${unindexed(collectionItems.collectionID)} in (select value from json_each(${placeholder("collectionIDs")}))`,
            eq(unindexed(items.libraryID), placeholder("libraryID")),
            gt(collectionItems.itemID, placeholder("afterItemID")),
          ),
        )
        .orderBy(collectionItems.itemID)
        .limit(placeholder("limit")),
  ),
} satisfies Record<CandidateLeaf["kind"], unknown>;

/**
 * The number that the hydrate reader gives back as `value` when SQLite stores
 * it as a number, or null. A stored number reads as its JavaScript string, so
 * `"12"` and `"1.5"` have one and `"012"` and `"12.0"` have none.
 */
export function storedNumberOf(value: string): number | null {
  const number = Number(value);
  return Number.isNaN(number) || String(number) !== value ? null : number;
}

export function storedIntegerOf(value: string): bigint | null {
  // Preserve the full SQLite INTEGER range; Number loses digits before the
  // index lookup. The round trip keeps spelling such as "012" text-only.
  try {
    const integer = BigInt(value);
    if (
      String(integer) === value &&
      integer >= -(2n ** 63n) &&
      integer < 2n ** 63n
    ) {
      return integer;
    }
  } catch {
    // The text does not name an INTEGER.
  }
  return null;
}

/** The rows of one leaf's statement. */
function leafRows(
  leaf: CandidateLeaf,
  scope: CandidateParams,
): Effect.Effect<
  { itemID: number }[],
  ItemQueryReaderError,
  ItemQueryDatabase
> {
  switch (leaf.kind) {
    case "tag":
      return candidateStatements.tag.all({ ...scope, value: leaf.value });
    case "keys":
      return candidateStatements.keys.all({
        ...scope,
        value: JSON.stringify(leaf.keys),
      });
    case "key":
      return candidateStatements.key.all({ ...scope, value: leaf.key });
    case "field":
      return candidateStatements.field.all({
        ...scope,
        value: leaf.value,
        number: storedNumberOf(leaf.value),
        integer: storedIntegerOf(leaf.value),
        fieldIDs: JSON.stringify(leaf.fieldIDs),
      });
    case "collection":
      return candidateStatements.collection.all({
        ...scope,
        collectionIDs: JSON.stringify(leaf.collectionIDs),
      });
  }
}

/**
 * Read the candidate set of one leaf: the IDs of the `items` rows of one
 * Library that the leaf can match, at most `limit` of them in ascending Item ID order. The set holds every Item of the query universe that matches
 * the leaf. It may hold more rows: a trashed Item, a child row. Restrict it
 * with {@link readUniverseRows} and decide each match with the evaluator.
 *
 * Pass the candidate cap plus one as `limit`: a set of `limit` IDs is above
 * the cap.
 */
export function readCandidateSet(candidates: {
  libraryID: number;
  leaf: CandidateLeaf;
  limit: number;
  afterItemID?: number;
}): Effect.Effect<number[], ItemQueryReaderError, ItemQueryDatabase> {
  const { libraryID, leaf, limit, afterItemID = 0 } = candidates;
  return Effect.map(leafRows(leaf, { libraryID, limit, afterItemID }), (rows) =>
    rows.map((row) => row.itemID),
  );
}
