// Web Worker adapter, renderer side: spawns the ZoteroReads worker and keeps one client across worker deaths.
import * as BrowserWorker from "@effect/platform-browser/BrowserWorker";
import {
  Cause,
  Deferred,
  Effect,
  Exit,
  Layer,
  Scope,
  Semaphore,
  Stream,
} from "effect";
import { RpcClient, RpcClientError, RpcSchema, RpcWorker } from "effect/rpc";

import { getLogger } from "@/lib/log";

import { makeChangeFeed } from "./connection";
import type { ZoteroReadsClient } from "./in-process";
import { DbUnavailable, ReadsConfigSchema, ZoteroReads } from "./rpc";
import type { ChangeEvent, ReadsConfig } from "./rpc";

const logger = getLogger("zotero-reads");

/**
 * Requests one worker serves at once. Above one, so a long stream never
 * blocks every other read behind it.
 */
const WORKER_CONCURRENCY = 16;

/** One live worker: its client, and a signal that completes if it dies. */
export interface WorkerConnection {
  readonly client: ZoteroReadsClient;
  /** Completes with the reason when the worker reports an error. */
  readonly died: Effect.Effect<DbUnavailable>;
}

/**
 * Spawn one worker from the embedded bundle and connect a client to it. The
 * worker gets `config` with its spawn and lives for the caller's scope; the
 * scope's end terminates it, since the platform layer only sends the close
 * message.
 */
export const connectWorker = Effect.fnUntraced(function* (
  source: string,
  config: Effect.Effect<ReadsConfig>,
): Effect.fn.Return<WorkerConnection, DbUnavailable, Scope.Scope> {
  const url = URL.createObjectURL(
    new Blob([source], { type: "text/javascript" }),
  );
  const workers = new Set<Worker>();
  const died = yield* Deferred.make<DbUnavailable>();
  // Added before the protocol, so it runs after the protocol's close message.
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      for (const worker of workers) worker.terminate();
      workers.clear();
      URL.revokeObjectURL(url);
    }),
  );

  const spawn = () => {
    // The protocol respawns a failed worker on its own; the one it replaces
    // is still running, so end it here.
    for (const worker of workers) worker.terminate();
    workers.clear();
    const worker = new Worker(url, { name: "zotlit-zotero-reads" });
    worker.addEventListener("error", (event) => {
      Deferred.doneUnsafe(
        died,
        Exit.succeed(
          new DbUnavailable({
            message: `The database worker failed: ${event.message || "unknown error"}`,
          }),
        ),
      );
    });
    workers.add(worker);
    return worker;
  };

  const protocol = yield* Layer.build(
    RpcClient.layerProtocolWorker({
      size: 1,
      concurrency: WORKER_CONCURRENCY,
    }).pipe(
      Layer.provide(BrowserWorker.layer(spawn)),
      Layer.provide(RpcWorker.layerInitialMessage(ReadsConfigSchema, config)),
    ),
  ).pipe(
    Effect.mapError(
      (error) =>
        new DbUnavailable({
          message: `The database worker did not start: ${error.message}`,
        }),
    ),
  );
  const client = yield* RpcClient.make(ZoteroReads).pipe(
    Effect.provideContext(protocol),
  );
  return { client, died: Deferred.await(died) };
});

/** The answer while no worker serves: the caller sees a client error. */
function noWorker(reason: DbUnavailable) {
  return new RpcClientError.RpcClientError({
    reason: new RpcClientError.RpcClientDefect({
      message: reason.message,
      cause: reason,
    }),
  });
}

/**
 * One {@link ZoteroReadsClient} across worker lifetimes. It connects on
 * creation. When the worker dies, the client reports `degraded` on `Changes`
 * with a {@link DbUnavailable}, calls fail with a client error, and the next
 * `Refresh` connects a new worker before it refreshes. The last worker ends
 * with the caller's scope.
 */
export const makeWorkerReads = Effect.fnUntraced(function* (
  connect: Effect.Effect<WorkerConnection, DbUnavailable, Scope.Scope>,
): Effect.fn.Return<ZoteroReadsClient, never, Scope.Scope> {
  const hostScope = yield* Effect.scope;
  let current: { client: ZoteroReadsClient; scope: Scope.Closeable } | null =
    null;
  let state: "loading" | "ready" | "degraded" = "loading";
  let lastError: DbUnavailable | null = null;
  const { publish, changes } = yield* makeChangeFeed(() => ({
    _tag: "state",
    state,
    error: lastError,
  }));
  const connecting = yield* Semaphore.make(1);

  /** End `connection` and report why; a no-op once it was replaced. */
  const die = (connection: typeof current, error: DbUnavailable) =>
    Effect.suspend(() => {
      if (!connection || current !== connection) return Effect.void;
      current = null;
      state = "degraded";
      lastError = error;
      logger.error("Database worker stopped", { error });
      return Effect.andThen(
        Scope.close(connection.scope, Exit.void),
        publish({ _tag: "degraded", error }),
      );
    });

  /** Track the worker's state from its own feed and pass the feed on. */
  const relay = (event: ChangeEvent): Effect.Effect<void> => {
    switch (event._tag) {
      case "state": {
        // The seed of a new worker's feed: a new client serves or fails.
        state = event.state;
        lastError = event.error;
        if (event.state === "ready") return publish({ _tag: "changed" });
        if (event.state === "degraded" && event.error)
          return publish({ _tag: "degraded", error: event.error });
        return Effect.void;
      }
      case "changed":
        state = "ready";
        lastError = null;
        break;
      case "degraded":
        state = "degraded";
        lastError = event.error;
        break;
      case "refresh-failed":
        lastError = event.error;
        break;
    }
    return publish(event);
  };

  const connectNew = Effect.gen(function* () {
    const scope = yield* Scope.make();
    const result = yield* Effect.exit(Scope.provide(connect, scope));
    if (Exit.isFailure(result)) {
      yield* Scope.close(scope, Exit.void);
      const error = Cause.findErrorOption(result.cause);
      const reason =
        error._tag === "Some"
          ? error.value
          : new DbUnavailable({ message: Cause.pretty(result.cause) });
      state = "degraded";
      lastError = reason;
      logger.error("Database worker did not start", { error: reason });
      yield* publish({ _tag: "degraded", error: reason });
      return yield* reason;
    }
    const connection = { client: result.value.client, scope };
    current = connection;
    // Either signal ends the connection: the worker's error event, or its
    // feed ending, which only happens when the transport broke.
    const lost = (message: string) =>
      Effect.forkIn(die(connection, new DbUnavailable({ message })), hostScope);
    yield* Effect.forkIn(
      Effect.flatMap(result.value.died, (error) =>
        Effect.forkIn(die(connection, error), hostScope),
      ),
      scope,
    );
    yield* Effect.forkIn(
      Stream.runForEach(connection.client.Changes(), relay).pipe(
        Effect.matchCauseEffect({
          onFailure: (cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.void
              : lost(
                  `The database worker connection broke: ${Cause.pretty(cause)}`,
                ),
          onSuccess: () => lost("The database worker connection ended"),
        }),
      ),
      scope,
    );
    return connection.client;
  });

  /** The live worker's client, connecting a new worker when none serves. */
  const ensureConnected = connecting.withPermits(1)(
    Effect.suspend(() =>
      current ? Effect.succeed(current.client) : connectNew,
    ),
  );

  yield* Effect.addFinalizer(() =>
    Effect.suspend(() => {
      const connection = current;
      current = null;
      return connection
        ? Scope.close(connection.scope, Exit.void)
        : Effect.void;
    }),
  );
  yield* Effect.ignore(ensureConnected);

  /** The live client, or a client error while no worker serves. */
  const live = Effect.suspend(() =>
    current
      ? Effect.succeed(current.client)
      : Effect.fail(
          noWorker(
            lastError ?? new DbUnavailable({ message: "No database worker" }),
          ),
        ),
  );

  const forwarded: Record<string, unknown> = {};
  for (const [tag, rpc] of ZoteroReads.requests) {
    const call = (
      client: ZoteroReadsClient,
      payload: unknown,
      options: unknown,
    ) =>
      (
        client as unknown as Record<
          string,
          (payload: unknown, options: unknown) => unknown
        >
      )[tag]!(payload, options);
    forwarded[tag] = RpcSchema.isStreamSchema(rpc.successSchema)
      ? (payload: unknown, options?: { asQueue?: boolean }) =>
          options?.asQueue
            ? Effect.flatMap(
                live,
                (client) =>
                  call(client, payload, options) as Effect.Effect<unknown>,
              )
            : Stream.unwrap(
                Effect.map(
                  live,
                  (client) =>
                    call(client, payload, options) as Stream.Stream<unknown>,
                ),
              )
      : (payload: unknown, options: unknown) =>
          Effect.flatMap(
            live,
            (client) =>
              call(client, payload, options) as Effect.Effect<unknown>,
          );
  }

  const reads = forwarded as unknown as ZoteroReadsClient;
  return {
    ...reads,
    // The feed outlives each worker: subscribers keep one stream across a
    // death and a respawn.
    Changes: () => changes,
    Refresh: (payload, options) =>
      Effect.flatMap(ensureConnected, (client) =>
        client.Refresh(payload, options),
      ),
  } as ZoteroReadsClient;
});
