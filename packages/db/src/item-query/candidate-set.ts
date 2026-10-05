import {
  collectionItems,
  itemData,
  itemDataValues,
  items,
  itemTags,
  tags,
} from "@drizzle/schema";
import { and, count, eq, or, sql } from "drizzle-orm";
import { Effect } from "effect";

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
  | { readonly kind: "tag"; readonly name: string }
  /** The Item with this Zotero Key. */
  | { readonly kind: "key"; readonly key: string }
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
}

interface ValueParams extends CandidateParams {
  value: string;
}

interface FieldParams extends ValueParams {
  /** The field IDs as a JSON array. */
  fieldIDs: string;
  /** The number that reads as `value`, or null. */
  number: number | null;
}

interface CollectionParams extends CandidateParams {
  /** The Collection IDs as a JSON array. */
  collectionIDs: string;
}

const candidateStatements = {
  tag: defineStatement<ValueParams>("candidate-set")((db, { placeholder }) =>
    db
      .select({ itemID: itemTags.itemID })
      .from(itemTags)
      .innerJoin(tags, eq(tags.tagID, itemTags.tagID))
      .innerJoin(items, eq(items.itemID, itemTags.itemID))
      .where(
        and(
          eq(tags.name, placeholder("value")),
          eq(unindexed(items.libraryID), placeholder("libraryID")),
        ),
      )
      .limit(placeholder("limit")),
  ),
  key: defineStatement<ValueParams>("candidate-set")((db, { placeholder }) =>
    db
      .select({ itemID: items.itemID })
      .from(items)
      .where(
        and(
          eq(items.libraryID, placeholder("libraryID")),
          eq(items.key, placeholder("value")),
        ),
      )
      .limit(placeholder("limit")),
  ),
  field: defineStatement<FieldParams>("candidate-set")((db, { placeholder }) =>
    db
      .selectDistinct({ itemID: items.itemID })
      .from(itemDataValues)
      // `itemData.valueID` has no declared type. The unary `+` keeps the
      // affinity of the value ID off the comparison, so the join starts at the
      // value and reads `itemData` through its `valueID` index.
      .innerJoin(
        itemData,
        eq(itemData.valueID, unindexed(itemDataValues.valueID)),
      )
      .innerJoin(items, eq(items.itemID, itemData.itemID))
      .where(
        and(
          or(
            eq(itemDataValues.value, placeholder("value")),
            eq(itemDataValues.value, placeholder("number")),
          ),
          // The value names the `itemData` rows; the field list checks them.
          sql`${unindexed(itemData.fieldID)} in (select value from json_each(${placeholder("fieldIDs")}))`,
          eq(unindexed(items.libraryID), placeholder("libraryID")),
        ),
      )
      .limit(placeholder("limit")),
  ),
  collection: defineStatement<CollectionParams>("candidate-set")(
    (db, { placeholder }) =>
      db
        .selectDistinct({ itemID: items.itemID })
        .from(collectionItems)
        .innerJoin(items, eq(items.itemID, collectionItems.itemID))
        .where(
          and(
            sql`${collectionItems.collectionID} in (select value from json_each(${placeholder("collectionIDs")}))`,
            eq(unindexed(items.libraryID), placeholder("libraryID")),
          ),
        )
        .limit(placeholder("limit")),
  ),
} satisfies Record<CandidateLeaf["kind"], unknown>;

/**
 * The number that the hydrate reader gives back as `value` when SQLite stores
 * it as a number, or null. A stored number reads as its JavaScript string, so
 * `"12"` and `"1.5"` have one and `"012"` and `"12.0"` have none.
 */
function storedNumberOf(value: string): number | null {
  const number = Number(value);
  return Number.isNaN(number) || String(number) !== value ? null : number;
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
      return candidateStatements.tag.all({ ...scope, value: leaf.name });
    case "key":
      return candidateStatements.key.all({ ...scope, value: leaf.key });
    case "field":
      return candidateStatements.field.all({
        ...scope,
        value: leaf.value,
        number: storedNumberOf(leaf.value),
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
 * Library that the leaf can match, at most `limit` of them and in no
 * defined order. The set holds every Item of the query universe that matches
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
}): Effect.Effect<number[], ItemQueryReaderError, ItemQueryDatabase> {
  const { libraryID, leaf, limit } = candidates;
  return Effect.map(leafRows(leaf, { libraryID, limit }), (rows) =>
    rows.map((row) => row.itemID),
  );
}
