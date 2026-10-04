import { items, itemTags, tags } from "@drizzle/schema";
import { and, count, eq } from "drizzle-orm";
import { Effect } from "effect";

import { defineStatement } from "./database";
import type { ItemQueryDatabase, ItemQueryReaderError } from "./database";

const libraryRowCountStatement = defineStatement<{ libraryID: number }>()(
  (db, { placeholder }) =>
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
  | { readonly kind: "key"; readonly key: string };

interface CandidateParams extends Record<string, unknown> {
  libraryID: number;
  value: string;
  limit: number;
}

const candidateStatements = {
  tag: defineStatement<CandidateParams>()((db, { placeholder }) =>
    db
      .select({ itemID: itemTags.itemID })
      .from(itemTags)
      .innerJoin(tags, eq(tags.tagID, itemTags.tagID))
      .innerJoin(items, eq(items.itemID, itemTags.itemID))
      .where(
        and(
          eq(tags.name, placeholder("value")),
          eq(items.libraryID, placeholder("libraryID")),
        ),
      )
      .limit(placeholder("limit")),
  ),
  key: defineStatement<CandidateParams>()((db, { placeholder }) =>
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
} satisfies Record<CandidateLeaf["kind"], unknown>;

/**
 * Read the candidate set of one leaf: the IDs of the `items` rows of the
 * Target Library that the leaf can match, at most `limit` of them and in no
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
  return Effect.map(
    candidateStatements[leaf.kind].all({
      libraryID,
      value: leaf.kind === "tag" ? leaf.name : leaf.key,
      limit,
    }),
    (rows) => rows.map((row) => row.itemID),
  );
}
