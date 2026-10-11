import {
  getIndexedItemIDsByLibrary,
  getIndexedItemsByID,
  getIndexSignature,
} from "@zotlit/db";
import type { GroupIDMemo } from "@zotlit/db";
import type { NodeDatabaseClient } from "@zotlit/db/client/node";
import { ItemSource, SourceUnavailable } from "@zotlit/item-lookup";
import type { PinnedItemSource } from "@zotlit/item-lookup";

// The Item Index's ItemSource port over the worker's Connection.
import { Effect, Layer, Stream } from "@/lib/effect";

import { Connection, toDbUnavailable } from "./connection";
import { itemsByIndexedKeys } from "./items-by-indexed-keys";

/** Run a synchronous read; a throw becomes a {@link SourceUnavailable}. */
function read<A>(
  client: NodeDatabaseClient,
  f: (client: NodeDatabaseClient) => A,
): Effect.Effect<A, SourceUnavailable> {
  return Effect.try({
    try: () => f(client),
    catch: (cause) =>
      new SourceUnavailable({ message: toDbUnavailable(cause).message }),
  });
}

/**
 * An {@link ItemSource} over {@link Connection}.
 *
 * - `pinned` borrows the current client for the caller's scope; every read of
 *   one build, and the hydration of the hits its index answers, goes to that
 *   client.
 * - The generation is the Connection's `databaseGeneration` of that client.
 * - `generation` emits on each `changed` and `degraded` event. The seed of
 *   the feed is a `state` event, so a new subscriber sees no emission.
 */
export const layerConnectionItemSource: Layer.Layer<
  ItemSource,
  never,
  Connection
> = Layer.effect(ItemSource)(
  Effect.gen(function* () {
    const connection = yield* Connection;
    return {
      generation: connection.changes.pipe(
        Stream.filter(
          (event) => event._tag === "changed" || event._tag === "degraded",
        ),
        Stream.as(undefined),
      ),
      pinned: Effect.gen(function* () {
        const client = yield* connection.borrow.pipe(
          Effect.mapError(
            (error) => new SourceUnavailable({ message: error.message }),
          ),
        );
        const memo: GroupIDMemo = new Map();
        return {
          generation: connection.databaseGeneration(client),
          itemIDs: (libraryID) =>
            read(client, (c) => getIndexedItemIDsByLibrary(c, libraryID)),
          items: (itemIDs) =>
            read(client, (c) => getIndexedItemsByID(c, itemIDs, { memo })),
          signature: (libraryID) =>
            read(client, (c) => getIndexSignature(c, libraryID)),
          itemsByIndexedKey: (indexedKeys) =>
            read(client, (c) => itemsByIndexedKeys(c, indexedKeys)),
        } satisfies PinnedItemSource;
      }),
    };
  }),
);
