// The Connection the ZoteroReads handlers borrow, and its RcRef-backed provider.
import { Context, Duration, Effect, Layer, RcRef } from "effect";
import type { Stream } from "effect";
import type { Scope } from "effect";

import { getLibraries, getZoteroDatabaseIdentity } from "@zotlit/db";
import type { ZoteroDatabaseIdentity } from "@zotlit/db";
import type { NodeDatabaseClient } from "@zotlit/db/client/node";

import { makeChangeFeed } from "./change-feed";
import { DbUnavailable } from "./rpc";
import type { ChangeEvent, ReadsConfig } from "./rpc";

/**
 * The database connection behind every ZoteroReads operation. A borrow lasts
 * for the caller's scope: a swap hands later borrowers a new client, and the
 * old one closes after its last borrower releases.
 */
export class Connection extends Context.Service<
  Connection,
  {
    /** Borrow the current client until the caller's scope closes. */
    readonly borrow: Effect.Effect<
      NodeDatabaseClient,
      DbUnavailable,
      Scope.Scope
    >;
    /** Lifecycle events, starting with the current state for each subscriber. */
    readonly changes: Stream.Stream<ChangeEvent>;
    /**
     * Open and validate a new client, then swap it in. Fails when the new
     * source fails, also when the previous client keeps serving.
     */
    readonly refresh: Effect.Effect<void, DbUnavailable>;
    /** A change signal from outside the process (a Zotero push). */
    readonly notifyExternalChange: Effect.Effect<void>;
    /** New settings for the source; the provider rebinds to them. */
    readonly configure: (config: ReadsConfig) => Effect.Effect<void>;
    /**
     * The database a client of this connection reads, as a number. The
     * number rises each time a client opens a database this connection has
     * not seen before: another file, or another Zotero identity (account,
     * local user key, server id) at the same path. Zotero reassigns local
     * Library ids across databases, so a held index built on an older number
     * rebuilds. A refresh that reopens the same database keeps the number,
     * and the signatures decide. Recorded when the client opens and
     * validates, so the call is synchronous and answers for every client this
     * connection hands out.
     */
    readonly databaseGeneration: (client: NodeDatabaseClient) => number;
  }
>()("zotlit/zotero-reads/Connection") {}

/** The database each client reads, for `Connection.databaseGeneration`. */
export function makeDatabaseGenerations() {
  /** The generation of each database seen so far. */
  const generations = new Map<string, number>();
  const clientGenerations = new WeakMap<NodeDatabaseClient, number>();
  return {
    /**
     * Record the database a validated client reads: the file it opened from
     * and the Zotero identity inside it. A client whose identity cannot be
     * read is closed before the throw, as in {@link validateClient}.
     */
    record: (client: NodeDatabaseClient, file: string | null): void => {
      let identity: ZoteroDatabaseIdentity;
      try {
        identity = getZoteroDatabaseIdentity(client);
      } catch (error) {
        client.$client.close();
        throw error;
      }
      const key = JSON.stringify([
        file,
        identity.userID,
        identity.localUserKey,
        identity.serverID,
      ]);
      let generation = generations.get(key);
      if (generation === undefined) {
        generation = generations.size + 1;
        generations.set(key, generation);
      }
      clientGenerations.set(client, generation);
    },
    databaseGeneration: (client: NodeDatabaseClient): number =>
      clientGenerations.get(client) ?? 0,
  };
}

/**
 * Opens a client for the configured source. Throws when the source cannot
 * open; the provider then validates the client before it serves.
 */
export type ConnectionOpener = (
  config: ReadsConfig | null,
) => NodeDatabaseClient;

/**
 * A failure as a {@link DbUnavailable}. The message is the innermost cause's:
 * a failed Drizzle query wraps the SQLite error that names the problem.
 */
export function toDbUnavailable(cause: unknown): DbUnavailable {
  let error = cause;
  while (error instanceof Error && error.cause instanceof Error) {
    error = error.cause;
  }
  return new DbUnavailable({
    message: error instanceof Error ? error.message : String(error),
  });
}

/**
 * Prove a client reads as a Zotero database before it serves; a client that
 * fails is closed before the throw.
 */
export function validateClient(client: NodeDatabaseClient): NodeDatabaseClient {
  try {
    getLibraries(client);
  } catch (error) {
    client.$client.close();
    throw error;
  }
  return client;
}

/** Open a client and prove it reads as a Zotero database before it serves. */
function openValidated(
  opener: ConnectionOpener,
  config: ReadsConfig | null,
): Effect.Effect<NodeDatabaseClient, DbUnavailable> {
  return Effect.try({
    try: () => validateClient(opener(config)),
    catch: toDbUnavailable,
  });
}

/** A client with the resources it holds open; `close` releases them all. */
export interface OpenClient {
  readonly client: NodeDatabaseClient;
  readonly close: Effect.Effect<void>;
}

/** An {@link OpenClient} that owns nothing beyond its SQLite handle. */
function bareClient(client: NodeDatabaseClient): OpenClient {
  return { client, close: Effect.sync(() => client.$client.close()) };
}

/**
 * The current client behind one `RcRef`. A borrow lasts for the caller's
 * scope; `swap` hands later borrowers a new client, and the old one closes
 * after its last borrower releases. With no client swapped in, a borrow runs
 * `fallback` to get one.
 */
export const makeClientRef = Effect.fnUntraced(function* (
  fallback: Effect.Effect<OpenClient, DbUnavailable>,
) {
  /** A client waiting for the next acquire. */
  let staged: OpenClient | null = null;
  const ref = yield* RcRef.make({
    acquire: Effect.acquireRelease(
      Effect.suspend(() => {
        const next = staged;
        staged = null;
        return next ? Effect.succeed(next) : fallback;
      }),
      (open) => open.close,
    ),
    idleTimeToLive: Duration.infinity,
  });
  yield* Effect.addFinalizer(() =>
    Effect.suspend(() => {
      const left = staged;
      staged = null;
      return left ? left.close : Effect.void;
    }),
  );
  return {
    borrow: Effect.map(RcRef.get(ref), (open) => open.client),
    /**
     * Hand later borrowers `next`. Run it in the same uninterruptible region
     * as the open, so a new client always has an owner. The ref is emptied
     * before any close awaits, so a borrower arriving meanwhile gets `next`
     * and keeps it.
     */
    swap: (next: OpenClient) =>
      Effect.suspend(() => {
        const replaced = staged;
        staged = next;
        return Effect.andThen(
          RcRef.invalidate(ref),
          replaced ? replaced.close : Effect.void,
        );
      }),
  };
});

/**
 * A {@link Connection} over one `RcRef`. A refresh opens and validates the new
 * source first; only a valid one invalidates the ref, so a failed refresh
 * leaves the current client serving and reports `refresh-failed`.
 */
export function layerRcRef(opener: ConnectionOpener): Layer.Layer<Connection> {
  return Layer.effect(Connection)(
    Effect.gen(function* () {
      let config: ReadsConfig | null = null;
      let state: "loading" | "ready" | "degraded" = "loading";
      let lastError: DbUnavailable | null = null;
      const databaseGenerations = makeDatabaseGenerations();
      /** Open and validate a client, recording the database it reads. */
      const openRecorded = Effect.suspend(() => {
        const opened = config?.databasePath ?? null;
        return Effect.tap(openValidated(opener, config), (client) =>
          Effect.try({
            try: () => databaseGenerations.record(client, opened),
            catch: toDbUnavailable,
          }),
        );
      });
      const { publish, changes } = yield* makeChangeFeed(() => [
        { _tag: "state", state, error: lastError },
      ]);

      /** A direct open (no refresh before it) reports the state it moves to. */
      const openDirect = openRecorded.pipe(
        Effect.map(bareClient),
        Effect.tap(() => {
          const wasReady = state === "ready";
          state = "ready";
          lastError = null;
          return wasReady ? Effect.void : publish({ _tag: "changed" });
        }),
        Effect.tapError((error) => {
          const wasDegraded = state === "degraded";
          state = "degraded";
          lastError = error;
          return wasDegraded
            ? Effect.void
            : publish({ _tag: "degraded", error });
        }),
      );
      const clients = yield* makeClientRef(openDirect);

      const swapIn = Effect.uninterruptible(
        Effect.flatMap(openRecorded, (client) => {
          state = "ready";
          lastError = null;
          return clients.swap(bareClient(client));
        }),
      );

      const refresh = Effect.gen(function* () {
        yield* publish({ _tag: "refreshing", active: true });
        const result = yield* Effect.result(swapIn);
        if (result._tag === "Failure") {
          lastError = result.failure;
          yield* publish({ _tag: "refresh-failed", error: result.failure });
          yield* publish({ _tag: "refreshing", active: false });
          return yield* result.failure;
        }
        yield* publish({ _tag: "changed" });
        yield* publish({ _tag: "refreshing", active: false });
      });

      return Connection.of({
        borrow: clients.borrow,
        changes,
        refresh,
        notifyExternalChange: Effect.ignore(refresh),
        configure: (next) =>
          Effect.suspend(() => {
            config = next;
            return Effect.ignore(refresh);
          }),
        databaseGeneration: databaseGenerations.databaseGeneration,
      });
    }),
  );
}
