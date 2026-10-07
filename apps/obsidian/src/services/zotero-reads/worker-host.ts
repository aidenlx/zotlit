// Web Worker adapter, renderer side: spawns the ZoteroReads worker and keeps one client across worker deaths.
import * as BrowserWorker from "@effect/platform-browser/BrowserWorker";
import {
  Cause,
  Deferred,
  Duration,
  Effect,
  Exit,
  Layer,
  Scope,
  Semaphore,
  Stream,
} from "effect";
import { RpcClient, RpcClientError, RpcSchema, RpcWorker } from "effect/rpc";

import { getLogger } from "@/lib/log";
import type { EffectiveReadMode } from "@/services/database/read-source";

import { makeChangeFeed } from "./change-feed";
import type { ZoteroReadsClient } from "./in-process";
import { DbUnavailable, ReadsConfigSchema, ZoteroReads } from "./rpc";
import type { ChangeEvent, ReadsConfig } from "./rpc";
import { WORKER_CLOSED } from "./worker-signal";

const logger = getLogger("zotero-reads");

/**
 * Requests one worker serves at once. A request holds its slot until it
 * ends, so `Changes`, every held Snapshot, and every open stream each keep
 * one for their whole life. The bound sits far above what the plugin holds
 * at once, so neither a read nor the liveness ping waits behind them.
 */
const WORKER_CONCURRENCY = 1024;

/** How long unload waits for a worker to remove its snapshots. */
const WORKER_CLOSE_TIMEOUT_MS = 5000;

/** How often the renderer asks a live worker to answer. */
const HEARTBEAT_INTERVAL = Duration.seconds(10);

/**
 * How long a worker may take to answer before it counts as hung. Every read
 * runs in slices of well under a second, so only a stuck worker misses it.
 */
const HEARTBEAT_TIMEOUT = Duration.seconds(15);

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
  /** Live workers, each with a promise that settles once it shut down. */
  const workers = new Map<Worker, Promise<void>>();
  const died = yield* Deferred.make<DbUnavailable>();
  // Added before the protocol, so it runs after the protocol's close message:
  // each worker gets to remove its snapshots before it is terminated.
  // A worker that never answers is terminated after a bounded wait.
  yield* Effect.addFinalizer(() =>
    Effect.promise(async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        Promise.all(workers.values()),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, WORKER_CLOSE_TIMEOUT_MS);
        }),
      ]);
      clearTimeout(timer);
      for (const worker of workers.keys()) worker.terminate();
      workers.clear();
      URL.revokeObjectURL(url);
    }),
  );

  const spawn = () => {
    // The protocol respawns a failed worker on its own; the one it replaces
    // is still running, so end it here.
    for (const worker of workers.keys()) worker.terminate();
    workers.clear();
    const worker = new Worker(url, { name: "zotlit-zotero-reads" });
    const shutDown = Promise.withResolvers<void>();
    worker.addEventListener("message", (event: MessageEvent<unknown>) => {
      if (event.data === WORKER_CLOSED) shutDown.resolve();
    });
    worker.addEventListener("error", (event) => {
      // A failed worker has nothing left to shut down.
      shutDown.resolve();
      Deferred.doneUnsafe(
        died,
        Exit.succeed(
          new DbUnavailable({
            message: `The database worker failed: ${event.message || "unknown error"}`,
          }),
        ),
      );
    });
    workers.set(worker, shutDown.promise);
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
  /** `db-file-missing` is raised once per launch, whichever worker saw it. */
  let missingSignalled = false;
  // A subscriber that arrives after the missing-file signal still gets it.
  /** The Read Mode of the live worker's connection, while it serves. */
  let readMode: EffectiveReadMode | undefined;
  const stateEvent = (): ChangeEvent => ({
    _tag: "state",
    state,
    error: lastError,
    ...(state === "ready" && readMode && { readMode }),
  });
  const { publish, changes } = yield* makeChangeFeed(() =>
    missingSignalled && state !== "ready"
      ? [stateEvent(), { _tag: "db-file-missing" }]
      : [stateEvent()],
  );
  const connecting = yield* Semaphore.make(1);

  /**
   * End `connection` and report why; a no-op once it was replaced. Holds the
   * connect permit, so no new worker reports before this one's `degraded`.
   */
  const die = (connection: NonNullable<typeof current>, error: DbUnavailable) =>
    connecting.withPermits(1)(
      Effect.suspend(() => {
        if (current !== connection) return Effect.void;
        current = null;
        state = "degraded";
        lastError = error;
        logger.error("Database worker stopped", { error });
        return Effect.andThen(
          Scope.close(connection.scope, Exit.void),
          publish({ _tag: "degraded", error }),
        );
      }),
    );

  /** Track the worker's state from its own feed and pass the feed on. */
  const relay = (event: ChangeEvent): Effect.Effect<void> => {
    switch (event._tag) {
      case "state": {
        // The seed of a new worker's feed: a new client serves or fails.
        state = event.state;
        lastError = event.error;
        readMode = event.readMode;
        if (event.state === "ready")
          return publish({
            _tag: "changed",
            ...(event.readMode && { readMode: event.readMode }),
          });
        if (event.state === "degraded" && event.error)
          return publish({ _tag: "degraded", error: event.error });
        return Effect.void;
      }
      case "changed":
        state = "ready";
        lastError = null;
        readMode = event.readMode;
        break;
      case "degraded":
        state = "degraded";
        lastError = event.error;
        readMode = undefined;
        break;
      case "refresh-failed":
        lastError = event.error;
        break;
      case "db-file-missing":
        if (missingSignalled) return Effect.void;
        missingSignalled = true;
        break;
    }
    return publish(event);
  };

  const connectNew = Effect.gen(function* () {
    // A child of the host's scope: whatever happens to this connect, the
    // worker it spawned ends with the host at the latest.
    const scope = yield* Scope.fork(hostScope);
    const result = yield* Scope.provide(connect, scope).pipe(
      Effect.onInterrupt(() => Scope.close(scope, Exit.void)),
      Effect.exit,
    );
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
    // A worker stuck in a loop sends no error event and keeps its transport
    // open; only a request it fails to answer shows it.
    yield* Effect.forkIn(
      Effect.gen(function* () {
        for (;;) {
          yield* Effect.sleep(HEARTBEAT_INTERVAL);
          const answer = yield* connection.client
            .Ping()
            .pipe(Effect.timeoutOption(HEARTBEAT_TIMEOUT), Effect.option);
          if (answer._tag === "Some" && answer.value._tag === "None") {
            return yield* lost("The database worker stopped responding");
          }
        }
      }),
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
