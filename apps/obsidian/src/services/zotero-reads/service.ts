import { RpcSchema } from "effect/rpc";
import type { RpcClientError } from "effect/rpc";

import { createNanoEvents } from "@zotlit/shared/nanoevents";

/**
 * `ZoteroReadsService` — the renderer's one handle on the Zotero database.
 *
 * The service owns a {@link ZoteroReadsClient} for the plugin's lifetime and
 * exposes it three ways:
 *
 * - `reads` on {@link ZoteroReadsService.ready}: the unbound interface, for
 *   single reads. Each call reads the current connection.
 * - {@link ZoteroReadsService.acquireRead} and
 *   {@link ZoteroReadsService.snapshot}: the same reads bound to one Snapshot,
 *   so several calls see one database state.
 * - The lifecycle surface: `state`, `error`, the events, `refresh()`, and
 *   `notifyExternalChange()`, all derived from the `Changes` stream.
 *
 * The adapter that makes the client is a dependency: the plugin runs the
 * handler layer in a Web Worker (`workerClient`); tests run it on this
 * runtime (`inProcessClient` in `test-utils.ts`).
 */
import { Cause, Effect, Exit, Pull, Scope, Stream } from "@/lib/effect";
import { openScope } from "@/lib/effect-scope";
import { getLogger } from "@/lib/log";
import type { EffectiveReadMode } from "@/services/database/read-source";
import { Service } from "@/services/service-base";

import type { ZoteroReadsClient } from "./in-process";
import { DbUnavailable, ZoteroReads } from "./rpc";
import type { ChangeEvent, SnapshotId } from "./rpc";

const logger = getLogger(["zotero-reads"]);

/** The operations that do not read the database. */
const LIFECYCLE_OPERATIONS = new Set([
  "Changes",
  "Snapshot",
  "Refresh",
  "NotifyExternalChange",
  "Configure",
  "Ping",
] as const satisfies readonly (keyof ZoteroReadsClient)[]);

type LifecycleOperation =
  typeof LIFECYCLE_OPERATIONS extends Set<infer T> ? T : never;

/** The read operations of ZoteroReads; each accepts an optional Snapshot. */
export type ZoteroReadsApi = Omit<ZoteroReadsClient, LifecycleOperation>;

/**
 * A Snapshot held by the renderer: `reads` all see one database state.
 * Disposal ends the Snapshot's stream; the worker hears of it within about
 * a second.
 */
export interface ZoteroReadLease extends AsyncDisposable {
  readonly reads: ZoteroReadsApi;
}

export interface ZoteroReadsEvents {
  /** A manual refresh or Freshness Signal asks every read capability to retry. */
  "refresh-requested": () => void;
  /** A new connection serves. Re-query if you cache results. */
  changed: () => void;
  /** No connection can serve. */
  degraded: (error: DbUnavailable) => void;
  /** A refresh failed; the previous connection keeps serving. */
  "refresh-failed": (error: DbUnavailable) => void;
  /** Refresh activity edge transitions. */
  refreshing: (active: boolean) => void;
  /** The configured database file is absent. */
  "db-file-missing": () => void;
}

export interface ZoteroReadsServiceDeps {
  /** Makes the client; it lives until the service's scope closes. */
  client: Effect.Effect<ZoteroReadsClient, never, Scope.Scope>;
}

/**
 * `client`'s read operations, each bound to the Snapshot `snapshot`. A stream
 * read buffers no slice ahead: the worker reads the next slice only after the
 * consumer pulled the last, so an abandoned stream wastes at most one slice.
 */
function bindReads(client: ZoteroReadsClient, snapshot?: SnapshotId) {
  const reads: Record<string, unknown> = {};
  for (const [tag, rpc] of ZoteroReads.requests) {
    if (LIFECYCLE_OPERATIONS.has(tag as LifecycleOperation)) continue;
    const call = client[tag as keyof ZoteroReadsApi] as (
      payload: object,
      options?: object,
    ) => unknown;
    const stream = RpcSchema.isStreamSchema(rpc.successSchema);
    reads[tag] = (payload: object, options?: object) =>
      call(
        snapshot === undefined ? payload : { ...payload, snapshot },
        stream ? { streamBufferSize: 0, ...options } : options,
      );
  }
  return reads as unknown as ZoteroReadsApi;
}

/**
 * Ends the Snapshot of a lease that was never disposed once the garbage
 * collector reclaims its reads, so a leaked lease cannot pin a connection
 * for the plugin's life.
 */
const leakedLeases = new FinalizationRegistry<() => Promise<void>>(
  (close) => void close(),
);

/** What {@link ZoteroReadsService.ready} resolves with. */
export interface ZoteroReadsReady {
  /**
   * The read operations on the current connection. Two calls can read
   * different database states; use a Snapshot to read one.
   */
  readonly reads: ZoteroReadsApi;
  /** The whole client, lifecycle operations included. */
  readonly client: ZoteroReadsClient;
}

export class ZoteroReadsService extends Service<ZoteroReadsReady> {
  readonly #makeClient;
  readonly #emitter = createNanoEvents<ZoteroReadsEvents>();
  #state: "loading" | "ready" | "degraded" = "loading";
  #error: DbUnavailable | null = null;
  #readMode: EffectiveReadMode | null = null;

  /** Settles once the client exists and its first state arrived. */
  ready: Promise<ZoteroReadsReady>;

  constructor(deps: ZoteroReadsServiceDeps) {
    super();
    this.#makeClient = deps.client;
    this.ready = this.#load();
  }

  get state(): "loading" | "ready" | "degraded" {
    return this.#state;
  }

  /** The Read Mode the serving connection opened with; `null` while none serves. */
  get activeReadMode(): EffectiveReadMode | null {
    return this.#readMode;
  }

  /** Why the service is degraded, or why the last refresh failed. */
  get error(): DbUnavailable | null {
    return this.#error;
  }

  /**
   * Open a Snapshot for the caller's scope: the returned reads all see one
   * database state, and closing the scope releases it.
   */
  get snapshot(): Effect.Effect<
    ZoteroReadsApi,
    DbUnavailable | RpcClientError.RpcClientError,
    Scope.Scope
  > {
    return Effect.tryPromise({
      try: () => this.ready,
      catch: () => new DbUnavailable({ message: "ZoteroReads did not start" }),
    }).pipe(
      Effect.flatMap(({ client }) =>
        Effect.flatMap(Stream.toPull(client.Snapshot()), (pull) =>
          pull.pipe(
            Pull.catchDone(() =>
              Effect.fail(
                new DbUnavailable({ message: "The Snapshot ended unopened" }),
              ),
            ),
            Effect.map(([id]) => bindReads(client, id)),
          ),
        ),
      ),
    );
  }

  /**
   * Open a Snapshot and hold it until the lease is disposed.
   *
   * @throws {@link DbUnavailable} when no connection can serve, or a client
   *   error when the worker does not answer.
   */
  async acquireRead(): Promise<ZoteroReadLease> {
    await this.ready;
    const { scope, close } = openScope();
    try {
      const reads = await Effect.runPromise(
        Scope.provide(this.snapshot, scope),
      );
      const token = {};
      leakedLeases.register(reads, close, token);
      return {
        reads,
        [Symbol.asyncDispose]: () => {
          leakedLeases.unregister(token);
          return close();
        },
      };
    } catch (error) {
      await close();
      throw error;
    }
  }

  /**
   * Open the source again and swap the new connection in.
   *
   * @throws {@link DbUnavailable} when the refresh fails, also when the
   *   previous connection keeps serving.
   */
  async refresh(): Promise<void> {
    this.#emitter.emit("refresh-requested");
    const { client } = await this.ready;
    await Effect.runPromise(client.Refresh());
  }

  /** A change signal from outside the plugin (a Zotero push). */
  notifyExternalChange(): void {
    this.#emitter.emit("refresh-requested");
    void this.ready
      .then(({ client }) => Effect.runPromise(client.NotifyExternalChange()))
      .catch((error: unknown) => {
        logger.warn("External change signal not delivered", { error });
      });
  }

  on<K extends keyof ZoteroReadsEvents>(
    event: K,
    cb: ZoteroReadsEvents[K],
  ): () => void {
    return this.#emitter.on(event, cb);
  }

  async #load(): Promise<ZoteroReadsReady> {
    await using stack = new AsyncDisposableStack();
    const { scope, close } = openScope();
    stack.defer(close);

    const client = await Effect.runPromise(
      Scope.provide(this.#makeClient, scope),
    );

    const seeded = Promise.withResolvers<void>();
    Effect.runSync(
      Stream.runForEach(client.Changes(), (event) =>
        Effect.sync(() => {
          this.#apply(event);
          seeded.resolve();
        }),
      ).pipe(
        // `Changes` runs for the client's life; only the service's own scope
        // ends it with an interrupt. Any other end means the adapter is lost.
        Effect.onExit((exit) =>
          Effect.sync(() => {
            seeded.resolve();
            // Unload ends the feed with the adapter; nothing was lost.
            if (this.disposing) return;
            if (Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)) {
              return;
            }
            logger.error("ZoteroReads change stream ended", { exit });
            this.#apply({
              _tag: "degraded",
              error: new DbUnavailable({
                message: "The connection to the Zotero database was lost",
              }),
            });
          }),
        ),
        Effect.forkIn(scope),
      ),
    );
    await seeded.promise;
    this.commit(stack.move());
    logger.info("ZoteroReads ready", { state: this.#state });
    return { reads: bindReads(client), client };
  }

  #apply(event: ChangeEvent): void {
    switch (event._tag) {
      case "state":
        this.#state = event.state;
        this.#error = event.error;
        this.#readMode = event.readMode ?? null;
        return;
      case "changed":
        this.#state = "ready";
        this.#error = null;
        this.#readMode = event.readMode ?? null;
        this.#emitter.emit("changed");
        return;
      case "degraded":
        this.#state = "degraded";
        this.#error = event.error;
        this.#readMode = null;
        this.#emitter.emit("degraded", event.error);
        return;
      case "refresh-failed":
        this.#error = event.error;
        this.#emitter.emit("refresh-failed", event.error);
        return;
      case "refreshing":
        this.#emitter.emit("refreshing", event.active);
        return;
      case "db-file-missing":
        this.#emitter.emit("db-file-missing");
        return;
    }
  }
}
