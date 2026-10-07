// The Item Index's ItemSource port over the worker's Connection.
import { Effect, Layer, Stream } from "effect";

import {
  getIndexedItemIDsByLibrary,
  getIndexedItemsByID,
  getIndexSignature,
  getZoteroDatabaseIdentity,
} from "@zotlit/db";
import type { GroupIDMemo } from "@zotlit/db";
import type { NodeDatabaseClient } from "@zotlit/db/client/node";
import { ItemSource, SourceUnavailable } from "@zotlit/item-lookup";
import type { PinnedItemSource } from "@zotlit/item-lookup";

import { Connection, toDbUnavailable } from "./connection";

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

/** The client each pinned source of {@link layerConnectionItemSource} reads. */
const pinnedClients = new WeakMap<PinnedItemSource, NodeDatabaseClient>();

/**
 * The client `source` reads, while its pinned scope is open; `undefined` for
 * a source this module did not pin.
 */
export const pinnedClient = (
  source: PinnedItemSource,
): NodeDatabaseClient | undefined => pinnedClients.get(source);

/**
 * An {@link ItemSource} over {@link Connection}.
 *
 * - `pinned` borrows the current client for the caller's scope; every read of
 *   one build goes to that client, and {@link pinnedClient} names it for
 *   hydration.
 * - The generation names the database a client reads: the configured file,
 *   with the account and Local API identity inside it. Zotero reassigns local
 *   Library ids across databases, so a client on another file, or another
 *   database at the same path, starts a new generation and every held index
 *   rebuilds. A new client on the same database (each refresh opens one)
 *   keeps the generation, and the signatures decide.
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
    /** The generation of each database identity seen so far. */
    const generations = new Map<string, number>();
    /** The generation of each client seen so far. */
    const clientGenerations = new WeakMap<NodeDatabaseClient, number>();
    let current = 0;

    const generationOf = (client: NodeDatabaseClient) =>
      Effect.suspend(() => {
        const known = clientGenerations.get(client);
        if (known !== undefined) return Effect.succeed(known);
        return Effect.map(read(client, getZoteroDatabaseIdentity), (id) => {
          const identity = JSON.stringify([
            connection.databaseFile(client),
            id.userID,
            id.localUserKey,
            id.serverID,
          ]);
          let generation = generations.get(identity);
          if (generation === undefined) {
            generation = generations.size + 1;
            generations.set(identity, generation);
          }
          clientGenerations.set(client, generation);
          current = generation;
          return generation;
        });
      });

    return {
      generation: connection.changes.pipe(
        Stream.filter(
          (event) => event._tag === "changed" || event._tag === "degraded",
        ),
        Stream.map(() => current),
      ),
      pinned: Effect.gen(function* () {
        const client = yield* connection.borrow.pipe(
          Effect.mapError(
            (error) => new SourceUnavailable({ message: error.message }),
          ),
        );
        const generation = yield* generationOf(client);
        const memo: GroupIDMemo = new Map();
        const pinned: PinnedItemSource = {
          generation,
          itemIDs: (libraryID) =>
            read(client, (c) => getIndexedItemIDsByLibrary(c, libraryID)),
          items: (itemIDs) =>
            read(client, (c) => getIndexedItemsByID(c, itemIDs, { memo })),
          signature: (libraryID) =>
            read(client, (c) => getIndexSignature(c, libraryID)),
        };
        pinnedClients.set(pinned, client);
        return pinned;
      }),
    };
  }),
);
