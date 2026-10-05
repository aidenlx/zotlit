import { collections, deletedCollections } from "@drizzle/schema";
import { and, eq, notExists } from "drizzle-orm";
import { Effect } from "effect";

import { defineStatement } from "./database";
import type { ItemQueryDatabase, ItemQueryReaderError } from "./database";

/**
 * The root-first name path of each live Collection of one Library, by
 * `collectionID`. A trashed Collection and every Collection below a trashed
 * ancestor have no entry, as Zotero's Collection tree hides them.
 */
export type CollectionPaths = ReadonlyMap<number, readonly string[]>;

const liveCollectionsStatement = defineStatement<{ libraryID: number }>(
  "collection-paths",
)((db, { placeholder }) =>
  db
    .select({
      collectionID: collections.collectionID,
      name: collections.collectionName,
      parentID: collections.parentCollectionID,
    })
    .from(collections)
    .where(
      and(
        eq(collections.libraryID, placeholder("libraryID")),
        notExists(
          db
            .select({ collectionID: deletedCollections.collectionID })
            .from(deletedCollections)
            .where(
              eq(deletedCollections.collectionID, collections.collectionID),
            ),
        ),
      ),
    ),
);

/**
 * Read the Collection paths of one Library. Read them once for each Target
 * Library of a query and pass them to every hydrate chunk that loads
 * `collections`.
 */
export function readCollectionPaths(library: {
  libraryID: number;
}): Effect.Effect<CollectionPaths, ItemQueryReaderError, ItemQueryDatabase> {
  return Effect.gen(function* () {
    const rows = yield* liveCollectionsStatement.all(library);
    return yield* Effect.sync(() => {
      const nodes = new Map(rows.map((row) => [row.collectionID, row]));
      // `null`: the Collection is below a trashed ancestor.
      const paths = new Map<number, readonly string[] | null>();
      const pathOf = (collectionID: number): readonly string[] | null => {
        const known = paths.get(collectionID);
        if (known !== undefined) return known;
        const node = nodes.get(collectionID);
        let path: readonly string[] | null = null;
        if (node) {
          // Zotero keeps the Collection tree acyclic, so the walk ends.
          const parent = node.parentID === null ? [] : pathOf(node.parentID);
          path = parent && [...parent, node.name];
        }
        paths.set(collectionID, path);
        return path;
      };
      const live = new Map<number, readonly string[]>();
      for (const collectionID of nodes.keys()) {
        const path = pathOf(collectionID);
        if (path) live.set(collectionID, path);
      }
      return live;
    });
  });
}
