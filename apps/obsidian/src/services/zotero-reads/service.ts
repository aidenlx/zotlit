/** The renderer's scoped database capability over the ZoteroReads RPC client. */
import {
  Cause,
  Context,
  Deferred,
  Effect,
  Exit,
  Layer,
  PubSub,
  Pull,
  Stream,
  SubscriptionRef,
} from "effect";
import type { Scope } from "effect";
import { RpcSchema } from "effect/rpc";
import type { RpcClientError } from "effect/rpc";

import { withLogCategory } from "@/lib/effect-log";
import type { EffectiveReadMode } from "@/services/database/read-source";

import type { ZoteroReadsClient } from "./in-process";
import { DbUnavailable, ZoteroReads as ZoteroReadsRpc } from "./rpc";
import type { ChangeEvent, SnapshotId } from "./rpc";

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
export type ZoteroReadsApi = Omit<ZoteroReadsClient, LifecycleOperation>;

export interface ZoteroReadLease extends AsyncDisposable {
  readonly reads: ZoteroReadsApi;
}

export interface ZoteroReadsEvents {
  "refresh-requested": () => void;
  changed: () => void;
  degraded: (error: DbUnavailable) => void;
  "refresh-failed": (error: DbUnavailable) => void;
  refreshing: (active: boolean) => void;
  "db-file-missing": () => void;
}

export interface ZoteroReadsState {
  readonly state: "loading" | "ready" | "degraded";
  readonly error: DbUnavailable | null;
  readonly moved: boolean;
  readonly dbFileMissing: boolean;
  readonly activeReadMode: EffectiveReadMode | null;
}

export type ZoteroReadsEvent =
  | Exclude<ChangeEvent, { readonly _tag: "state" }>
  | { readonly _tag: "refresh-requested" };

export class ZoteroReads extends Context.Service<
  ZoteroReads,
  {
    readonly current: Effect.Effect<ZoteroReadsState>;
    readonly changes: Stream.Stream<ZoteroReadsState>;
    readonly events: Stream.Stream<ZoteroReadsEvent>;
    readonly reads: ZoteroReadsApi;
    readonly snapshot: Effect.Effect<
      ZoteroReadsApi,
      DbUnavailable | RpcClientError.RpcClientError,
      Scope.Scope
    >;
    readonly refresh: Effect.Effect<
      void,
      DbUnavailable | RpcClientError.RpcClientError
    >;
    readonly notifyExternalChange: Effect.Effect<void>;
  }
>()("zotlit/zotero-reads/ZoteroReads") {}

function bindReads(client: ZoteroReadsClient, snapshot?: SnapshotId) {
  const reads: Record<string, unknown> = {};
  for (const [tag, rpc] of ZoteroReadsRpc.requests) {
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

/** The transport owns its workers and connections on this layer's Scope. */
export function layerZoteroReads<R>(
  makeClient: Effect.Effect<ZoteroReadsClient, never, R | Scope.Scope>,
) {
  return Layer.effect(
    ZoteroReads,
    Effect.gen(function* () {
      const state = yield* SubscriptionRef.make<ZoteroReadsState>({
        state: "loading",
        error: null,
        moved: false,
        dbFileMissing: false,
        activeReadMode: null,
      });
      const events = yield* PubSub.unbounded<ZoteroReadsEvent>();
      const seeded = yield* Deferred.make<void>();
      let closed = false;
      const client = yield* makeClient;
      const current = SubscriptionRef.get(state);
      const apply = Effect.fn("ZoteroReads.apply")(function* (
        event: ChangeEvent,
      ) {
        switch (event._tag) {
          case "state":
            yield* SubscriptionRef.update(state, (before) => ({
              state: event.state,
              error: event.error,
              moved: event.moved ?? false,
              activeReadMode: event.readMode ?? null,
              dbFileMissing:
                event.state === "ready" ? false : before.dbFileMissing,
            }));
            break;
          case "changed":
            yield* SubscriptionRef.set(state, {
              state: "ready",
              error: null,
              moved: false,
              dbFileMissing: false,
              activeReadMode: event.readMode ?? null,
            });
            break;
          case "db-file-missing":
            yield* SubscriptionRef.update(state, (before) => ({
              ...before,
              dbFileMissing: true,
            }));
            break;
          case "degraded":
            yield* SubscriptionRef.update(state, (before) => ({
              ...before,
              state: "degraded" as const,
              error: event.error,
              activeReadMode: null,
            }));
            break;
          case "refresh-failed":
            yield* SubscriptionRef.update(state, (before) => ({
              ...before,
              error: event.error,
              moved: event.moved,
            }));
            break;
        }
        if (event._tag !== "state") yield* PubSub.publish(events, event);
        yield* Deferred.succeed(seeded, undefined);
      });
      yield* Stream.runForEach(client.Changes(), (event) => apply(event)).pipe(
        Effect.onExit((exit) =>
          Effect.gen(function* () {
            if (
              closed ||
              (Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause))
            )
              return;
            yield* Effect.logError("ZoteroReads change stream ended").pipe(
              Effect.annotateLogs({ exit }),
            );
            yield* apply({
              _tag: "degraded",
              error: new DbUnavailable({
                message: "The connection to the Zotero database was lost",
              }),
            });
          }),
        ),
        Effect.forkScoped({ startImmediately: true }),
      );
      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          closed = true;
          yield* PubSub.shutdown(state.pubsub);
          yield* PubSub.shutdown(events);
        }),
      );
      const snapshot = Effect.gen(function* () {
        if (closed)
          return yield* new DbUnavailable({ message: "ZoteroReads is closed" });
        const pull = yield* Stream.toPull(client.Snapshot());
        const [id] = yield* pull.pipe(
          Pull.catchDone(() =>
            Effect.fail(
              new DbUnavailable({ message: "The Snapshot ended unopened" }),
            ),
          ),
        );
        return bindReads(client, id);
      });
      yield* Deferred.await(seeded);
      if ((yield* current).state === "loading") {
        // Legacy ready waited for the feed seed, including loading. The first
        // database read belongs to the Scope; consumers follow its state.
        yield* client.Libraries({}).pipe(
          Effect.catchCause((cause) =>
            Effect.gen(function* () {
              if (Cause.hasInterruptsOnly(cause))
                return yield* Effect.interrupt;
              if ((yield* current).state !== "loading") return;
              const error = Cause.squash(cause);
              yield* apply({
                _tag: "degraded",
                error:
                  error instanceof DbUnavailable
                    ? error
                    : new DbUnavailable({ message: String(error) }),
              });
            }),
          ),
          Effect.forkScoped(),
        );
      }
      yield* Effect.logInfo("ZoteroReads ready").pipe(
        Effect.annotateLogs({ state: (yield* current).state }),
      );
      return ZoteroReads.of({
        current,
        changes: SubscriptionRef.changes(state),
        events: Stream.fromPubSub(events),
        reads: bindReads(client),
        snapshot,
        refresh: Effect.gen(function* () {
          if (closed) return;
          yield* PubSub.publish(events, { _tag: "refresh-requested" });
          yield* client.Refresh();
        }).pipe(Effect.withSpan("ZoteroReads.refresh")),
        notifyExternalChange: Effect.gen(function* () {
          if (closed) return;
          yield* PubSub.publish(events, { _tag: "refresh-requested" });
          yield* client
            .NotifyExternalChange()
            .pipe(
              Effect.catchCause((error) =>
                Effect.logWarning("External change signal not delivered").pipe(
                  Effect.annotateLogs({ error }),
                ),
              ),
            );
        }).pipe(
          withLogCategory("zotero-reads"),
          Effect.withSpan("ZoteroReads.notifyExternalChange"),
        ),
      });
    }).pipe(withLogCategory("zotero-reads")),
  );
}
