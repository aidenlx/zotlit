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
 * The adapter that makes the client is a dependency: {@link inProcessClient}
 * runs the handler layer on this runtime; a worker adapter can replace it.
 */
import { Cause, Effect, Exit, Layer, Pull, Scope, Stream } from "effect";
import type { RpcClientError } from "effect/rpc";

import { createNanoEvents } from "@zotlit/shared/nanoevents";

import { getLogger } from "@/lib/log";
import { Service } from "@/services/service-base";

import type { Connection } from "./connection";
import { makeInProcessClient } from "./in-process";
import type { ZoteroReadsClient } from "./in-process";
import { DbUnavailable } from "./rpc";
import type { ChangeEvent } from "./rpc";

const logger = getLogger(["zotero-reads"]);

/** The operations that read the database; each accepts an optional Snapshot. */
const READ_OPERATIONS = [
  "Libraries",
  "ConnectionReadout",
  "IndexItems",
  "IndexSignature",
  "ItemsByIndexedKeys",
  "ItemFamily",
  "NoteSource",
  "AnnotationSources",
  "AnnotationsOfAttachment",
  "AttachmentsOf",
  "DisplayRefs",
  "NoteBodies",
  "WorkLabels",
  "AttachmentPathIndex",
  "CitekeySnapshot",
  "AnnotViewAttachments",
  "ReaderTargetKeys",
  "ZoteroIdentity",
  "AttachmentsAt",
] as const satisfies readonly (keyof ZoteroReadsClient)[];

/** The read operations of ZoteroReads. */
export type ZoteroReadsApi = Pick<
  ZoteroReadsClient,
  (typeof READ_OPERATIONS)[number]
>;

/** A Snapshot held by the renderer: `reads` all see one database state. */
export interface ZoteroReadLease extends Disposable {
  readonly reads: ZoteroReadsApi;
}

export interface ZoteroReadsEvents {
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

/** The handler layer on this runtime over `connection`, for the caller's scope. */
export const inProcessClient = Effect.fnUntraced(function* (
  connection: Layer.Layer<Connection>,
): Effect.fn.Return<ZoteroReadsClient, never, Scope.Scope> {
  const services = yield* Layer.build(connection);
  return yield* Effect.provideContext(makeInProcessClient(), services);
});

/** `client`'s read operations, each bound to the Snapshot `snapshot`. */
function bindReads(client: ZoteroReadsClient, snapshot?: string) {
  const reads: Record<string, unknown> = {};
  for (const operation of READ_OPERATIONS) {
    const call = client[operation] as (
      payload: object,
      options?: object,
    ) => unknown;
    reads[operation] =
      snapshot === undefined
        ? call
        : (payload: object, options?: object) =>
            call({ ...payload, snapshot }, options);
  }
  return reads as unknown as ZoteroReadsApi;
}

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
   * @throws {@link DbUnavailable} when no connection can serve.
   */
  async acquireRead(): Promise<ZoteroReadLease> {
    await this.ready;
    const scope = Effect.runSync(Scope.make());
    const release = () => Effect.runPromise(Scope.close(scope, Exit.void));
    try {
      const reads = await Effect.runPromise(
        Scope.provide(this.snapshot, scope),
      );
      return { reads, [Symbol.dispose]: () => void release() };
    } catch (error) {
      await release();
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
    const { client } = await this.ready;
    await Effect.runPromise(client.Refresh());
  }

  /** A change signal from outside the plugin (a Zotero push). */
  notifyExternalChange(): void {
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
    const scope = Effect.runSync(Scope.make());
    stack.defer(() => Effect.runPromise(Scope.close(scope, Exit.void)));

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
        return;
      case "changed":
        this.#state = "ready";
        this.#error = null;
        this.#emitter.emit("changed");
        return;
      case "degraded":
        this.#state = "degraded";
        this.#error = event.error;
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
