// Citation Lookup: fresh command reads and view-owned Held Reads of requested keys.
import { QueryObserver } from "@tanstack/query-core";
import type { QueryObserverOptions } from "@tanstack/query-core";
import type { RpcClientError } from "effect/rpc";

import {
  Cause,
  Context,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  PubSub,
  Scope,
  Stream,
  SubscriptionRef,
} from "@/lib/effect";
import { withLogCategory } from "@/lib/effect-log";
import { forkEach } from "@/lib/effect-stream";
import { LibraryScope } from "@/services/library-scope/service";
import { QueryClients } from "@/services/query-client/service";
import type { Held } from "@/services/query-client/service";
import { DbUnavailable } from "@/services/zotero-reads/rpc";
import { ZoteroReads } from "@/services/zotero-reads/service";

import { CitationLookupAnswer } from "./lookup";
import type { CitationLookupRequest } from "./lookup";

export interface CitationLookupObservation extends Disposable {
  readonly current: Held<CitationLookupAnswer> | null;
  set(request: CitationLookupRequest): void;
}
export type CitationLookupStatus =
  | Held<CitationLookupAnswer>["status"]
  | "pending";
export interface CitationLookupState {
  readonly status: CitationLookupStatus;
  readonly revision: string | null;
  readonly stopped: boolean;
}
export class CitationLookup extends Context.Service<
  CitationLookup,
  {
    readonly current: Effect.Effect<CitationLookupState>;
    readonly changes: Stream.Stream<CitationLookupState>;
    readonly invalidated: Stream.Stream<void>;
    /** A fresh answer from one published revision; unavailable reads fail. */
    read(
      request: CitationLookupRequest,
    ): Effect.Effect<
      CitationLookupAnswer,
      DbUnavailable | RpcClientError.RpcClientError
    >;
    observe(changed: () => void): Effect.Effect<CitationLookupObservation>;
    /** Wait for the current publication attempt, including failure or unload. */
    whenResolved(): Effect.Effect<void>;
  }
>()("zotlit/citation-index/CitationLookup") {}

const LOOKUP_KEY = ["citation-lookup"] as const;
const GC_TIME = Temporal.Duration.from({ minutes: 5 }).total("milliseconds");

export function inertObservation(): CitationLookupObservation {
  return { current: null, set: () => {}, [Symbol.dispose]: () => {} };
}

export const layerCitationLookup = Layer.effect(
  CitationLookup,
  Effect.gen(function* () {
    const reads = yield* ZoteroReads;
    const libraryScope = yield* LibraryScope;
    const queries = yield* QueryClients;
    const scope = yield* Scope.Scope;
    const context = yield* Effect.context<never>();
    const run = Effect.runSyncWith(context);
    const runPromise = Effect.runPromiseWith(context);
    const subscriptions = yield* Scope.fork(scope);
    const state = yield* SubscriptionRef.make<CitationLookupState>({
      status: "pending",
      revision: null,
      stopped: false,
    });
    const current = SubscriptionRef.get(state);
    // Including the terminal state lets even a subscriber after close see it.
    const changes = SubscriptionRef.changes(state).pipe(
      Stream.takeUntil((state) => state.stopped),
    );
    const events = yield* PubSub.unbounded<void>();
    const invalidated = Stream.fromPubSub(events);
    const stop = yield* Deferred.make<never>();
    const observations = new Set<() => void>();
    let refresh: Fiber.Fiber<void> | undefined;
    const recover = <A, E>(effect: Effect.Effect<A, E>) =>
      effect.pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.interrupt
            : Effect.logWarning("Citation lookup refresh failed", cause),
        ),
        withLogCategory("citation-index"),
      );
    const setStatus = Effect.fn("CitationLookup.setStatus")(function* (
      status: CitationLookupStatus,
    ) {
      const before = yield* current;
      if (before.stopped || before.status === status) return;
      yield* SubscriptionRef.set(state, { ...before, status });
      if (status === "fresh" && before.status === "failed")
        void queries.client.refetchQueries({
          queryKey: LOOKUP_KEY,
          type: "active",
          predicate: (query) => query.state.status === "error",
        });
    });
    const read = Effect.fn("CitationLookup.read")(
      function* (request: CitationLookupRequest) {
        const citekeys = [...new Set(request.citekeys ?? [])];
        const indexedKeys = [...new Set(request.indexedKeys ?? [])];
        const annotationKeys = [...new Set(request.annotationKeys ?? [])];
        while (true) {
          if ((yield* current).stopped) return yield* Effect.interrupt;
          if ((yield* reads.current).state !== "ready") {
            yield* setStatus("failed");
            return yield* new DbUnavailable({
              message: "ZoteroReads is unavailable",
            });
          }
          const selected = yield* libraryScope.effective;
          const result = yield* Effect.result(
            reads.reads.CitationLookup({
              scope: selected,
              citekeys,
              indexedKeys,
              annotationKeys,
            }),
          );
          if (
            JSON.stringify(selected) !==
            JSON.stringify(yield* libraryScope.effective)
          )
            continue;
          if (result._tag === "Failure") {
            yield* setStatus("failed");
            return yield* result.failure;
          }
          const answer = new CitationLookupAnswer(result.success);
          const before = yield* current;
          yield* setStatus("fresh");
          if (before.revision !== answer.revision)
            yield* SubscriptionRef.update(state, (snapshot) => ({
              ...snapshot,
              revision: answer.revision,
            }));
          return answer;
        }
      },
      Effect.raceFirst(Deferred.await(stop)),
    );
    /** Pins only this view's query. Request changes use its previous answer as a placeholder. */
    const observe = Effect.fn("CitationLookup.observe")(function* (
      changed: () => void,
    ) {
      if ((yield* SubscriptionRef.get(state)).stopped)
        return inertObservation();
      const client = queries.client;
      let request: CitationLookupRequest | null = null;
      let identity: string | null = null;
      let current: Held<CitationLookupAnswer> | null = null;
      let previous: CitationLookupAnswer | undefined;
      let disposed = false;
      const options = (): QueryObserverOptions<CitationLookupAnswer> => ({
        queryKey: [
          ...LOOKUP_KEY,
          run(libraryScope.effective),
          request?.citekeys ?? [],
          request?.indexedKeys ?? [],
          request?.annotationKeys ?? [],
        ],
        queryFn: ({ signal }) => runPromise(read(request!), { signal }),
        enabled: request !== null,
        gcTime: GC_TIME,
        placeholderData: (answer) => answer ?? previous,
        structuralSharing: (old, value) => {
          const answer = value as CitationLookupAnswer;
          // Parent links can change while the Citekey Resolution Snapshot stays equal.
          return old instanceof CitationLookupAnswer &&
            old.revision === answer.revision &&
            (request?.annotationKeys ?? []).every((key) => {
              if (
                !old.coversAnnotationKey(key) ||
                !answer.coversAnnotationKey(key)
              )
                return false;
              const before = old.parentOfAnnotation(key);
              const after = answer.parentOfAnnotation(key);
              return (
                before?.indexedKey === after?.indexedKey &&
                before?.citekey === after?.citekey
              );
            })
            ? old
            : answer;
        },
      });
      const observer = new QueryObserver(client, options());
      const publish = (): void => {
        if (disposed) return;
        const result = observer.getCurrentResult();
        // query-core drops placeholderData on error. The view still owns the
        // last delivered answer, including one from its previous request.
        const value = result.data ?? previous;
        previous = value;
        const query = observer.getCurrentQuery();
        current =
          value === undefined
            ? null
            : {
                value,
                status:
                  result.isFetching || (result.isStale && !result.isError)
                    ? "revalidating"
                    : result.isError
                      ? "failed"
                      : "fresh",
                settled: Promise.resolve()
                  .then(() => query.promise)
                  .then(
                    (answer) => answer ?? value,
                    () => (disposed ? null : value),
                  ),
              };
        try {
          changed();
        } catch (error) {
          run(
            Effect.logWarning("Lookup observer failed").pipe(
              Effect.annotateLogs({ error }),
              withLogCategory("citation-index"),
            ),
          );
        }
      };
      const unsubscribe = observer.subscribe(publish);
      const observation = yield* Scope.fork(subscriptions);
      const dispose = (): void => {
        if (disposed) return;
        disposed = true;
        unsubscribe();
        observer.destroy();
        void runPromise(Scope.close(observation, Exit.void));
        observations.delete(dispose);
        current = null;
        previous = undefined;
      };
      yield* Scope.provide(
        forkEach(invalidated, (): void => {
          if (request && !disposed) observer.setOptions(options());
        }),
        observation,
      );
      yield* Scope.provide(
        forkEach(changes, (state): void => {
          if (state.stopped) dispose();
        }),
        observation,
      );
      observations.add(dispose);
      return {
        get current() {
          return current;
        },
        set(next) {
          if (disposed) return;
          const selected = {
            citekeys: [...new Set(next.citekeys ?? [])].sort(),
            indexedKeys: [...new Set(next.indexedKeys ?? [])].sort(),
            annotationKeys: [...new Set(next.annotationKeys ?? [])].sort(),
          };
          const nextIdentity = JSON.stringify(selected);
          if (identity === nextIdentity) return;
          identity = nextIdentity;
          request = selected;
          observer.setOptions(options());
        },
        [Symbol.dispose]: dispose,
      };
    });

    const invalidate = Effect.fn("CitationLookup.invalidate")(function* () {
      yield* setStatus(
        (yield* current).revision === null ? "pending" : "revalidating",
      );
      yield* queries.invalidate(LOOKUP_KEY);
      yield* PubSub.publish(events, undefined);
      void queries.client.refetchQueries({
        queryKey: LOOKUP_KEY,
        type: "active",
      });
    });
    const revalidate = Effect.fn("CitationLookup.revalidate")(function* () {
      if ((yield* current).stopped) return;
      yield* invalidate();
      refresh = yield* Effect.forkIn(
        read({}).pipe(Effect.asVoid, recover),
        scope,
        { startImmediately: true },
      );
    });
    yield* Stream.runForEach(reads.events, (event) =>
      recover(
        Effect.gen(function* () {
          if (event._tag === "changed") yield* revalidate();
          else if (event._tag === "degraded") {
            yield* invalidate();
            yield* setStatus("failed");
            yield* Effect.logWarning("ZoteroReads unavailable").pipe(
              Effect.annotateLogs({ error: event.error }),
            );
          }
        }),
      ),
    ).pipe(Effect.forkScoped({ startImmediately: true }));
    let previous = yield* libraryScope.state;
    yield* Stream.runForEach(libraryScope.changes, (next) => {
      const before = previous;
      previous = next;
      return before.current !== next.current ||
        before.invalid !== next.invalid ||
        before.all !== next.all
        ? recover(revalidate())
        : Effect.void;
    }).pipe(Effect.forkScoped({ startImmediately: true }));
    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        yield* SubscriptionRef.update(state, (snapshot) => ({
          ...snapshot,
          stopped: true,
        }));
        yield* Deferred.interrupt(stop);
        for (const dispose of observations) dispose();
        queries.client.removeQueries({ queryKey: LOOKUP_KEY });
        yield* PubSub.shutdown(events);
      }),
    );
    // Legacy ready registered intake and started this attempt; it never awaited the database.
    yield* revalidate();
    return CitationLookup.of({
      current,
      changes,
      invalidated,
      read,
      observe,
      whenResolved: Effect.fn("CitationLookup.whenResolved")(function* () {
        // Let queued dependency notifications start their replacement attempt.
        yield* Effect.yieldNow;
        if (refresh) yield* Fiber.await(refresh);
      }),
    });
  }).pipe(withLogCategory("citation-index")),
);
