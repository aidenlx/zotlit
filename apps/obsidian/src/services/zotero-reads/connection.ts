// The Connection the ZoteroReads handlers borrow, and its RcRef-backed provider.
import {
  Context,
  Duration,
  Effect,
  Layer,
  PubSub,
  RcRef,
  Stream,
} from "effect";
import type { Scope } from "effect";

import { getLibraries } from "@zotlit/db";
import type { NodeDatabaseClient } from "@zotlit/db/client/node";

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
    /** Open and validate a new client, then swap it in. */
    readonly refresh: Effect.Effect<void, DbUnavailable>;
    /** A change signal from outside the process (a Zotero push). */
    readonly notifyExternalChange: Effect.Effect<void>;
    /** New settings for the source; the provider rebinds to them. */
    readonly configure: (config: ReadsConfig) => Effect.Effect<void>;
  }
>()("zotlit/zotero-reads/Connection") {}

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

/** Open a client and prove it reads as a Zotero database before it serves. */
function openValidated(
  opener: ConnectionOpener,
  config: ReadsConfig | null,
): Effect.Effect<NodeDatabaseClient, DbUnavailable> {
  return Effect.try({
    try: () => {
      const client = opener(config);
      try {
        getLibraries(client);
      } catch (error) {
        client.$client.close();
        throw error;
      }
      return client;
    },
    catch: toDbUnavailable,
  });
}

/**
 * A {@link Connection} over one `RcRef`. A refresh opens and validates the new
 * source first; only a valid one invalidates the ref, so a failed refresh
 * leaves the current client serving and reports `refresh-failed`.
 */
export function layerRcRef(opener: ConnectionOpener): Layer.Layer<Connection> {
  return Layer.effect(Connection)(
    Effect.gen(function* () {
      let config: ReadsConfig | null = null;
      /** A validated client waiting for the next acquire. */
      let staged: NodeDatabaseClient | null = null;
      let state: "loading" | "ready" | "degraded" = "loading";
      let lastError: DbUnavailable | null = null;
      const events = yield* PubSub.unbounded<ChangeEvent>();
      const publish = (event: ChangeEvent) =>
        PubSub.publish(events, event).pipe(Effect.asVoid);

      /**
       * Open a client for the ref. A staged client comes from a refresh that
       * already reported it; a direct open reports the state it moves to.
       */
      const acquire = Effect.suspend(() => {
        const next = staged;
        staged = null;
        if (next) return Effect.succeed(next);
        return openValidated(opener, config).pipe(
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
      });

      const ref = yield* RcRef.make({
        acquire: Effect.acquireRelease(acquire, (client) =>
          Effect.sync(() => client.$client.close()),
        ),
        idleTimeToLive: Duration.infinity,
      });

      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          staged?.$client.close();
          staged = null;
        }),
      );

      // Uninterruptible from the open to the hand-off into `staged`, so a
      // validated client always has an owner.
      const swapIn = Effect.uninterruptible(
        Effect.flatMap(
          Effect.suspend(() => openValidated(opener, config)),
          (client) => {
            staged?.$client.close();
            staged = client;
            state = "ready";
            lastError = null;
            return RcRef.invalidate(ref);
          },
        ),
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
        borrow: RcRef.get(ref),
        // Subscribe before reading the state, so no event falls between the
        // seed and the live feed.
        changes: Stream.unwrap(
          Effect.map(PubSub.subscribe(events), (subscription) => {
            const seed: ChangeEvent = {
              _tag: "state",
              state,
              error: lastError,
            };
            return Stream.concat(
              Stream.make(seed),
              Stream.fromSubscription(subscription),
            );
          }),
        ),
        refresh,
        notifyExternalChange: Effect.ignore(refresh),
        configure: (next) =>
          Effect.suspend(() => {
            config = next;
            return Effect.ignore(refresh);
          }),
      });
    }),
  );
}
