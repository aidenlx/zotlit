import {
  collectionItems,
  itemData,
  itemDataValues,
  items,
  itemTags,
} from "@drizzle/schema";
import { and, count, eq, gt, lte, max, or, sql } from "drizzle-orm";
import { Effect } from "effect";

import type { TagCandidateLeaf, KeysCandidateLeaf } from "./candidate-leaf";
import { candidateTag } from "./candidate-predicates";
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
 * An Item candidate leaf: an indexed seek or a bounded text sweep.
 */
export type CandidateLeaf = SeekCandidateLeaf | TextSweepCandidateLeaf;

export interface TextSweepCandidateLeaf {
  readonly kind: "text-sweep";
  readonly fieldIDs: readonly number[];
  readonly pattern: string;
}

/** Leaves answered by one indexed statement, including on relation paths. */
export type SeekCandidateLeaf =
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

const statements = (bounded: boolean) =>
  ({
    keys: defineStatement<ValueParams>(
      bounded ? "parent-leaf-candidate-set" : "candidate-set",
    )((db, { placeholder }) =>
      db
        .select({ itemID: items.itemID })
        .from(items)
        .where(
          and(
            eq(items.libraryID, placeholder("libraryID")),
            gt(items.itemID, placeholder("afterItemID")),
            sql`${items.key} in (select value from json_each(${placeholder("value")}))`,
          ),
        )
        .orderBy(...(bounded ? [] : [items.itemID]))
        .limit(placeholder("limit")),
    ),
    tag: defineStatement<ValueParams>(
      bounded ? "parent-leaf-candidate-set" : "candidate-set",
    )((db, { placeholder }) =>
      db
        .select({ itemID: itemTags.itemID })
        .from(itemTags)
        .innerJoin(items, eq(items.itemID, itemTags.itemID))
        .where(
          and(
            candidateTag(db, placeholder("value")),
            eq(unindexed(items.libraryID), placeholder("libraryID")),
            gt(items.itemID, placeholder("afterItemID")),
          ),
        )
        .orderBy(...(bounded ? [] : [items.itemID]))
        .limit(placeholder("limit")),
    ),
    key: defineStatement<ValueParams>(
      bounded ? "parent-leaf-candidate-set" : "candidate-set",
    )((db, { placeholder }) =>
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
        .orderBy(...(bounded ? [] : [items.itemID]))
        .limit(placeholder("limit")),
    ),
    field: defineStatement<FieldParams>(
      bounded ? "parent-leaf-candidate-set" : "candidate-set",
    )((db, { placeholder }) =>
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
              eq(itemDataValues.value, placeholder("integer")),
            ),
            // The value names the `itemData` rows; the field list checks them.
            sql`${unindexed(itemData.fieldID)} in (select value from json_each(${placeholder("fieldIDs")}))`,
            eq(unindexed(items.libraryID), placeholder("libraryID")),
            gt(items.itemID, placeholder("afterItemID")),
          ),
        )
        .orderBy(...(bounded ? [] : [items.itemID]))
        .limit(placeholder("limit")),
    ),
    collection: defineStatement<CollectionParams>(
      bounded ? "parent-leaf-candidate-set" : "candidate-set",
    )((db, { placeholder }) =>
      db
        .selectDistinct({ itemID: items.itemID })
        .from(collectionItems)
        .innerJoin(items, eq(items.itemID, collectionItems.itemID))
        .where(
          and(
            sql`${collectionItems.collectionID} in (select value from json_each(${placeholder("collectionIDs")}))`,
            eq(unindexed(items.libraryID), placeholder("libraryID")),
            gt(items.itemID, placeholder("afterItemID")),
          ),
        )
        .orderBy(...(bounded ? [] : [items.itemID]))
        .limit(placeholder("limit")),
    ),
  }) satisfies Record<SeekCandidateLeaf["kind"], unknown>;

const candidateStatements = statements(false);
const parentStatements = statements(true);

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
  leaf: SeekCandidateLeaf,
  scope: CandidateParams,
  statements = candidateStatements,
): Effect.Effect<
  { itemID: number }[],
  ItemQueryReaderError,
  ItemQueryDatabase
> {
  switch (leaf.kind) {
    case "tag":
      return statements.tag.all({ ...scope, value: leaf.value });
    case "keys":
      return statements.keys.all({
        ...scope,
        value: JSON.stringify(leaf.keys),
      });
    case "key":
      return statements.key.all({ ...scope, value: leaf.key });
    case "field":
      return statements.field.all({
        ...scope,
        value: leaf.value,
        number: storedNumberOf(leaf.value),
        integer: storedIntegerOf(leaf.value),
        fieldIDs: JSON.stringify(leaf.fieldIDs),
      });
    case "collection":
      return statements.collection.all({
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
  leaf: SeekCandidateLeaf;
  limit: number;
  afterItemID?: number;
}): Effect.Effect<number[], ItemQueryReaderError, ItemQueryDatabase> {
  const { libraryID, leaf, limit, afterItemID = 0 } = candidates;
  return Effect.map(leafRows(leaf, { libraryID, limit, afterItemID }), (rows) =>
    rows.map((row) => row.itemID),
  );
}

/** Read the parent leaf's matches up to its work budget in index order. */
export function readBoundedCandidateSet(candidates: {
  libraryID: number;
  leaf: SeekCandidateLeaf;
  limit: number;
}) {
  const { libraryID, leaf, limit } = candidates;
  return Effect.map(
    leafRows(leaf, { libraryID, limit, afterItemID: 0 }, parentStatements),
    (rows) => rows.map((row) => row.itemID),
  );
}

/** Item ID span of one statement; independent of the number of matches. */
export const TEXT_SWEEP_WINDOW_SIZE = 2_000;

const maxItemIDStatement = defineStatement<Record<string, never>>(
  "max-item-id",
)((db) => db.select({ itemID: max(items.itemID) }).from(items));

/** Read once for a candidate plan that contains a root text sweep. */
export const readMaxItemID = Effect.map(
  maxItemIDStatement.all({}),
  (rows) => rows[0]?.itemID ?? 0,
);

const textSweepStatement = defineStatement<{
  libraryID: number;
  afterItemID: number;
  throughItemID: number;
  fieldIDs: string;
  pattern: string;
  limit: number;
}>("text-sweep-window")((db, { placeholder: p }) =>
  db
    .selectDistinct({ itemID: itemData.itemID })
    .from(itemData)
    .crossJoin(itemDataValues)
    .crossJoin(items)
    .where(
      and(
        gt(itemData.itemID, p("afterItemID")),
        lte(itemData.itemID, p("throughItemID")),
        sql`${unindexed(itemData.fieldID)} in (select value from json_each(${p("fieldIDs")}))`,
        eq(itemDataValues.valueID, itemData.valueID),
        sql`(typeof(${itemDataValues.value}) <> 'text' OR instr(${itemDataValues.value}, char(0)) > 0 OR ${itemDataValues.value} LIKE ${p("pattern")})`,
        eq(items.itemID, itemData.itemID),
        eq(unindexed(items.libraryID), p("libraryID")),
      ),
    )
    .orderBy(itemData.itemID)
    .limit(p("limit")),
);

/** One window on the itemData primary key, then the stored value and Library. */
export function readTextSweepWindow({
  leaf,
  ...page
}: {
  libraryID: number;
  leaf: TextSweepCandidateLeaf;
  afterItemID: number;
  limit: number;
}) {
  return Effect.map(
    textSweepStatement.all({
      ...page,
      throughItemID: page.afterItemID + TEXT_SWEEP_WINDOW_SIZE,
      fieldIDs: JSON.stringify(leaf.fieldIDs),
      pattern: leaf.pattern,
    }),
    // The window bounds exclude null itemData IDs.
    (rows) => rows.map((row) => row.itemID!),
  );
}
