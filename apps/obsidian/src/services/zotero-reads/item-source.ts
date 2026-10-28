// The Item Index's ItemSource port over the worker's Connection.
import { Effect, Layer, Stream } from "effect";

import {
  getIndexedItemIDsByLibrary,
  getIndexedItemsByID,
  getIndexSignatureRange,
  getItemIDBounds,
} from "@zotlit/db";
import type { IndexSignature } from "@zotlit/db";
import type { GroupIDMemo } from "@zotlit/db";
import type { NodeDatabaseClient } from "@zotlit/db/client/node";
import { ItemSource, SourceUnavailable } from "@zotlit/item-lookup";
import type { PinnedItemSource } from "@zotlit/item-lookup";

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
 * Item IDs per signature read. A read is one synchronous task in the worker,
 * and a search waits for the task in progress: on the Stress Build of
 * 100,000 Items, a range of this size reads in a few milliseconds, far under
 * the 100 ms search limit, where the whole Library took 60–96 ms.
 */
const SIGNATURE_RANGE = 10_000;

/**
 * A Library's {@link IndexSignature} on `client`, summed over ranges of Item
 * IDs with a yield between them, so a search waits for one range at most.
 */
const signatureOf = (client: NodeDatabaseClient, libraryID: number) =>
  Effect.gen(function* () {
    const bounds = yield* read(client, (c) => getItemIDBounds(c, libraryID));
    const signature: IndexSignature = { count: 0, checksum: 0 };
    if (!bounds) return signature;
    for (let from = bounds.min; from <= bounds.max; from += SIGNATURE_RANGE) {
      yield* Effect.yieldNow;
      const part = yield* read(client, (c) =>
        getIndexSignatureRange(c, libraryID, {
          from,
          to: from + SIGNATURE_RANGE,
        }),
      );
      signature.count += part.count;
      signature.checksum += part.checksum;
    }
    return signature;
  });

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
          signature: (libraryID) => signatureOf(client, libraryID),
          itemsByIndexedKey: (indexedKeys) =>
            read(client, (c) => itemsByIndexedKeys(c, indexedKeys)),
        } satisfies PinnedItemSource;
      }),
    };
  }),
);
