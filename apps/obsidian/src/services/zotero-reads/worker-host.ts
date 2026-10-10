// Web Worker adapter, renderer side: spawns the ZoteroReads worker and keeps one client across worker deaths.
import * as BrowserWorker from "@effect/platform-browser/BrowserWorker";
import { getLogger as getLogTapeLogger } from "@logtape/logtape";
import type { LogRecord } from "@logtape/logtape";
import {
  Cause,
  Deferred,
  Duration,
  Effect,
  Exit,
  Fiber,
  Layer,
  Scope,
  Semaphore,
  Stream,
} from "effect";
import { RpcClient, RpcClientError, RpcSchema, RpcWorker } from "effect/rpc";
import { tmpdir } from "node:os";

import { getLogger } from "@/lib/log";
import { readParentBeside } from "@/services/database/read-parent";
import type { EffectiveReadMode } from "@/services/database/read-source";
import { reapWorkerClones } from "@/services/database/reap-temps";

import { makeStateFeed } from "./change-feed";
import type { ZoteroReadsClient } from "./in-process";
import { DbUnavailable, WorkerInitSchema, ZoteroReads } from "./rpc";
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
const WORKER_CLOSE_TIMEOUT = Duration.seconds(5);

/** Bound the initial handshake and each later recovery attempt. */
const WORKER_START_TIMEOUT = Duration.seconds(15);

/** How often the renderer asks a live worker to answer. */
const HEARTBEAT_INTERVAL = Duration.seconds(10);

/**
 * How long a worker may take to answer before it counts as hung. Every read
 * runs in slices of well under a second, so only a stuck worker misses it.
 */
const HEARTBEAT_TIMEOUT = Duration.seconds(15);

/**
 * How long a second ping may take after the first went unanswered. A timer
 * that ran on through system sleep fires at wake before the answer lands;
 * the second ping tells that from a stuck worker.
 */
const HEARTBEAT_RETRY_TIMEOUT = Duration.seconds(5);

/** One live worker: its client, and a signal that completes if it dies. */
export interface WorkerConnection {
  readonly client: ZoteroReadsClient;
  /** Completes with the reason when the worker reports an error. */
  readonly died: Effect.Effect<DbUnavailable>;
  /**
   * Terminates the worker at once, for a transport that is already gone: the
   * scope's end then skips the wait for a close the worker cannot confirm.
   */
  readonly abandon: Effect.Effect<void>;
}

/**
 * Spawn one worker from the embedded bundle and connect a client to it. The
 * worker gets `config` with its spawn and lives for the caller's scope; the
 * scope's end terminates it, since the platform layer only sends the close
 * message. Its log records reach the plugin's logger under their own
 * categories. Its read snapshots carry an owner tag of this connection's own,
 * so the scope's end also removes the ones a crashed worker left behind.
 */
export const connectWorker = Effect.fnUntraced(function* (
  source: string,
  config: Effect.Effect<ReadsConfig>,
  {
    reapClones = reapWorkerClones,
  }: { reapClones?: typeof reapWorkerClones } = {},
): Effect.fn.Return<WorkerConnection, DbUnavailable, Scope.Scope> {
  const url = URL.createObjectURL(
    new Blob([source], { type: "text/javascript" }),
  );
  /** Live workers, each with a promise that settles once it shut down. */
  const workers = new Map<Worker, Promise<void>>();
  /** The port the live worker posts its log records to. */
  let logs: MessagePort | undefined;
  const died = yield* Deferred.make<DbUnavailable>();
  const snapshotOwner = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
  /** Every database path a worker of this connection was given. */
  const databasePaths = new Set<string>();
  // Added first, so it runs last: once every worker here is terminated, no
  // snapshot with this tag has a reader left. Detached, so neither a respawn
  // nor unload waits on the file system; the sweep reports its own failures,
  // and what it cannot remove the next launch reaps.
  yield* Effect.addFinalizer(() =>
    Effect.map(config, ({ databasePath }) => {
      databasePaths.add(databasePath);
      void reapClones({
        owner: snapshotOwner,
        parents: [tmpdir(), ...Array.from(databasePaths, readParentBeside)],
      });
    }),
  );
  // Added before the protocol, so it runs after the protocol's close message:
  // each worker gets to remove its snapshots before it is terminated.
  // A worker that never answers is terminated after a bounded wait.
  yield* Effect.addFinalizer(() =>
    Effect.promise(() => Promise.all(workers.values())).pipe(
      Effect.timeoutOption(WORKER_CLOSE_TIMEOUT),
      Effect.andThen(
        Effect.sync(() => {
          for (const worker of workers.keys()) worker.terminate();
          workers.clear();
          logs?.close();
          URL.revokeObjectURL(url);
        }),
      ),
    ),
  );

  const spawn = () => {
    // The protocol respawns a failed worker on its own; the one it replaces
    // is still running, so end it here.
    for (const worker of workers.keys()) worker.terminate();
    workers.clear();
    const worker = new Worker(url, {
      name: "zotlit-zotero-reads",
    });
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
      Layer.provide(
        RpcWorker.layerInitialMessage(
          WorkerInitSchema,
          Effect.map(config, (current) => {
            databasePaths.add(current.databasePath);
            // Each worker gets its own channel; the one it replaces is
            // terminated already.
            logs?.close();
            const { port1, port2 } = new MessageChannel();
            port1.onmessage = ({ data: record }: MessageEvent<LogRecord>) =>
              getLogTapeLogger(record.category).emit(record);
            logs = port1;
            return {
              ...current,
              snapshotOwner,
              logs: port2,
            };
          }),
        ),
      ),
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
  // With no live workers left, the finalizer has nothing to wait for.
  const abandon = Effect.sync(() => {
    for (const worker of workers.keys()) worker.terminate();
    workers.clear();
  });
  return { client, died: Deferred.await(died), abandon };
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
 * `Refresh` connects a new worker before it refreshes.
 * The last worker ends with the caller's scope.
 */
export const makeWorkerReads = Effect.fnUntraced(function* (
  connect: Effect.Effect<WorkerConnection, DbUnavailable, Scope.Scope>,
): Effect.fn.Return<ZoteroReadsClient, never, Scope.Scope> {
  const hostScope = yield* Effect.scope;
  let current: {
    client: ZoteroReadsClient;
    scope: Scope.Closeable;
    abandon: Effect.Effect<void>;
  } | null = null;
  let state: "loading" | "ready" | "degraded" = "loading";
  let lastError: DbUnavailable | null = null;
  /** `db-file-missing` is raised once per launch, whichever worker saw it. */
  let missingSignalled = false;
  /** The Read Mode of the live worker's connection, while it serves. */
  let readMode: EffectiveReadMode | undefined;
  const { publish, changes } = yield* makeStateFeed(() => ({
    state,
    error: lastError,
    readMode,
    missing: missingSignalled,
  }));
  const connecting = yield* Semaphore.make(1);

  /**
   * End `connection` and report why; a no-op once it was replaced. Holds the
   * connect permit, so no new worker reports before this one's `degraded`.
   * With `transportGone`, the worker is abandoned instead of closed.
   */
  const die = (
    connection: NonNullable<typeof current>,
    error: DbUnavailable,
    transportGone = false,
  ) =>
    connecting.withPermits(1)(
      Effect.suspend(() => {
        if (current !== connection) return Effect.void;
        current = null;
        state = "degraded";
        lastError = error;
        logger.error("Database worker stopped", { error });
        return Effect.andThen(
          transportGone ? connection.abandon : Effect.void,
          Effect.andThen(
            Scope.close(connection.scope, Exit.void),
            publish({ _tag: "degraded", error }),
          ),
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
      Effect.timeoutOrElse({
        duration: WORKER_START_TIMEOUT,
        orElse: () =>
          Effect.fail(
            new DbUnavailable({
              message: "The database worker did not start in time",
            }),
          ),
      }),
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
    const connection = {
      client: result.value.client,
      scope,
      abandon: result.value.abandon,
    };
    current = connection;
    // Either signal ends the connection: the worker's error event, or its
    // feed ending, which only happens when the transport broke.
    const lost = (message: string, transportGone = false) =>
      Effect.forkIn(
        die(connection, new DbUnavailable({ message }), transportGone),
        hostScope,
      );
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
          // `true` when the worker answered, `false` when the wait ran out;
          // a transport failure is the `Changes` watcher's to report.
          const answered = (timeout: Duration.Duration) =>
            connection.client.Ping().pipe(
              Effect.timeoutOption(timeout),
              Effect.map((answer) => answer._tag === "Some"),
              Effect.orElseSucceed(() => true),
            );
          if (
            !(yield* answered(HEARTBEAT_TIMEOUT)) &&
            !(yield* answered(HEARTBEAT_RETRY_TIMEOUT))
          ) {
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
                  true,
                ),
          onSuccess: () => lost("The database worker connection ended", true),
        }),
      ),
      scope,
    );
    return connection.client;
  });

  /** The live worker's client, connecting a new worker when none serves. */
  const ensureConnected = connecting
    .withPermits(1)(
      Effect.suspend(() => {
        if (hostScope.state._tag === "Closed")
          return Effect.fail(
            new DbUnavailable({ message: "The database worker stopped" }),
          );
        return current ? Effect.succeed(current.client) : connectNew;
      }),
    )
    .pipe(
      Effect.forkIn(hostScope),
      Effect.flatMap((fiber) =>
        Fiber.join(fiber).pipe(
          Effect.onInterrupt(() => Fiber.interrupt(fiber)),
        ),
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
    Configure: (payload, options) =>
      Effect.flatMap(ensureConnected, (client) =>
        client.Configure(payload, options),
      ),
    Refresh: (payload, options) =>
      Effect.flatMap(ensureConnected, (client) =>
        client.Refresh(payload, options),
      ),
  } as ZoteroReadsClient;
});
