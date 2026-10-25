// The Connection the ZoteroReads handlers borrow, and its RcRef-backed provider.
import {
  Context,
  Duration,
  Effect,
  Layer,
  Predicate,
  RcRef,
  Ref,
  Schema,
} from "effect";
import type { Stream } from "effect";
import type { Scope } from "effect";

import { getZoteroDatabaseIdentity } from "@zotlit/db";
import type { NodeDatabaseClient } from "@zotlit/db/client/node";
import {
  checkDatabaseLayout,
  ItemQueryLayoutError,
} from "@zotlit/db/item-query";

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
    /**
     * The database file a client of this connection opened from, or null
     * when it opened from no file. Recorded with the generation, so it
     * answers for every client this connection hands out.
     */
    readonly databaseFile: (client: NodeDatabaseClient) => string | null;
  }
>()("zotlit/zotero-reads/Connection") {}

/** The database each client reads, for `Connection.databaseGeneration`. */
export function makeDatabaseGenerations() {
  /** The generation of each database seen so far. */
  const generations = new Map<string, number>();
  const clientGenerations = new WeakMap<NodeDatabaseClient, number>();
  const clientFiles = new WeakMap<NodeDatabaseClient, string | null>();
  const record = Effect.fnUntraced(function* (
    client: NodeDatabaseClient,
    file: string | null,
  ): Effect.fn.Return<void, DbUnavailable> {
    const identity = yield* Effect.try({
      try: () => getZoteroDatabaseIdentity(client),
      catch: toDbUnavailable,
    }).pipe(Effect.tapError(() => closeClient(client)));
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
    clientFiles.set(client, file);
  });
  return {
    /**
     * Record the database a validated client reads: the file it opened from
     * and the Zotero identity inside it.
     *
     * @returns Fails with the identity read's error after the client closes.
     * @see {@link validateClient}, which closes a client the same way.
     */
    record,
    databaseGeneration: (client: NodeDatabaseClient): number => {
      const generation = clientGenerations.get(client);
      if (generation === undefined)
        throw new DbUnavailable({
          message: "The client was not opened by this connection",
        });
      return generation;
    },
    databaseFile: (client: NodeDatabaseClient): string | null =>
      clientFiles.get(client) ?? null,
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
 * The layout check threw for a reason other than a layout gap: the file is not
 * a Zotero database, or a statement failed. `message` is the original's, which
 * {@link toDbUnavailable} reads through `cause`.
 */
export class ClientValidationError extends Schema.TaggedError<
  ClientValidationError,
  { readonly brand: unique symbol }
>()("ClientValidationError", {
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

/**
 * Prove a client reads as a Zotero database before it serves: its layout has
 * every table and column the readers need, so a copy that validates is a copy
 * Item Query reads. The layout read stays with the client, so the readers and
 * `reportSchemaVersions` run no statement for it again. On failure, the Effect
 * closes the client before it fails with the layout error.
 */
export const validateClient = Effect.fnUntraced(function* (
  client: NodeDatabaseClient,
): Effect.fn.Return<
  NodeDatabaseClient,
  ItemQueryLayoutError | ClientValidationError
> {
  yield* Effect.try({
    try: () => checkDatabaseLayout(client),
    catch: (error) =>
      error instanceof ItemQueryLayoutError
        ? error
        : new ClientValidationError({
            message: Error.isError(error) ? error.message : String(error),
            cause: error,
          }),
  }).pipe(Effect.tapError(() => closeClient(client)));
  return client;
});

/** Open a client and prove it reads as a Zotero database before it serves. */
function openValidated(
  opener: ConnectionOpener,
  config: ReadsConfig | null,
): Effect.Effect<NodeDatabaseClient, DbUnavailable> {
  return Effect.try({
    try: () => opener(config),
    catch: toDbUnavailable,
  }).pipe(
    Effect.flatMap((client) =>
      validateClient(client).pipe(
        Effect.mapError((cause) => toDbUnavailable(cause)),
      ),
    ),
  );
}

function closeClient(client: NodeDatabaseClient): Effect.Effect<void> {
  return Effect.sync(() => client.$client.close()).pipe(
    Effect.catchDefect(() => Effect.void),
  );
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
  const staged = yield* Ref.make<OpenClient | null>(null);
  const ref = yield* RcRef.make({
    acquire: Effect.acquireRelease(
      Ref.getAndSet(staged, null).pipe(
        Effect.filterOrElse(Predicate.isNotNull, () => fallback),
      ),
      (open) => open.close,
    ),
    idleTimeToLive: Duration.infinity,
  });
  yield* Effect.addFinalizer(() =>
    Ref.getAndSet(staged, null).pipe(
      Effect.flatMap((left) => (left ? left.close : Effect.void)),
    ),
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
      Ref.getAndSet(staged, next).pipe(
        Effect.flatMap((replaced) =>
          Effect.andThen(
            RcRef.invalidate(ref),
            replaced ? replaced.close : Effect.void,
          ),
        ),
      ),
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
      const config = yield* Ref.make<ReadsConfig | null>(null);
      const status = yield* Ref.make<{
        state: "loading" | "ready" | "degraded";
        lastError: DbUnavailable | null;
        serving: string | null;
        moved: boolean;
      }>({
        state: "loading",
        lastError: null as DbUnavailable | null,
        /** The database file the serving client opened from. */
        serving: null,
        /** The last refresh failed for another database than `serving`. */
        moved: false,
      });
      const databaseGenerations = makeDatabaseGenerations();
      /** Open and validate a client, recording the database it reads. */
      const openRecorded = Ref.get(config).pipe(
        Effect.flatMap((current) => {
          const opened = current?.databasePath ?? null;
          return Effect.tap(openValidated(opener, current), (client) =>
            databaseGenerations.record(client, opened),
          );
        }),
      );
      const { publish, changes } = yield* makeChangeFeed(() => {
        const current = Ref.getUnsafe(status);
        return [
          {
            _tag: "state",
            state: current.state,
            error: current.lastError,
            ...(current.lastError !== null &&
              current.state !== "degraded" && { moved: current.moved }),
          },
        ];
      });

      /** A direct open (no refresh before it) reports the state it moves to. */
      const openDirect = openRecorded.pipe(
        Effect.tap((client) =>
          Ref.update(status, (current) => ({
            ...current,
            serving: databaseGenerations.databaseFile(client),
          })),
        ),
        Effect.map((client) => bareClient(client)),
        Effect.tap(() =>
          Effect.gen(function* () {
            const wasReady = (yield* Ref.get(status)).state === "ready";
            yield* Ref.update(status, (current) => ({
              ...current,
              state: "ready" as const,
              lastError: null,
              moved: false,
            }));
            if (!wasReady) yield* publish({ _tag: "changed" });
          }),
        ),
        Effect.tapError((error) =>
          Effect.gen(function* () {
            const wasDegraded = (yield* Ref.get(status)).state === "degraded";
            yield* Ref.update(status, (current) => ({
              ...current,
              state: "degraded" as const,
              lastError: error,
            }));
            if (!wasDegraded) yield* publish({ _tag: "degraded", error });
          }),
        ),
      );
      const clients = yield* makeClientRef(openDirect);

      const swapIn = Effect.uninterruptible(
        Effect.flatMap(openRecorded, (client) =>
          Effect.gen(function* () {
            yield* Ref.update(status, (current) => ({
              ...current,
              state: "ready" as const,
              lastError: null,
              moved: false,
              serving: databaseGenerations.databaseFile(client),
            }));
            yield* clients.swap(bareClient(client));
          }),
        ),
      );

      const refresh = Effect.gen(function* () {
        yield* publish({ _tag: "refreshing", active: true });
        const result = yield* Effect.result(swapIn);
        if (result._tag === "Failure") {
          const currentConfig = yield* Ref.get(config);
          const current = yield* Ref.modify(status, (before) => [
            {
              moved: (currentConfig?.databasePath ?? null) !== before.serving,
            },
            {
              ...before,
              lastError: result.failure,
              moved: (currentConfig?.databasePath ?? null) !== before.serving,
            },
          ]);
          yield* publish({
            _tag: "refresh-failed",
            error: result.failure,
            moved: current.moved,
          });
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
        configure: Effect.fn("Connection.configure")((next) =>
          Ref.set(config, next).pipe(Effect.andThen(Effect.ignore(refresh))),
        ),
        databaseGeneration: databaseGenerations.databaseGeneration,
        databaseFile: databaseGenerations.databaseFile,
      });
    }),
  );
}
