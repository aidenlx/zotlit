// The one query client every Held Read is realized on, and the Held Read projection of a query's state.

import { abortable } from "@std/async/abortable";
import {
  CancelledError,
  focusManager,
  partialMatchKey,
  QueryClient,
} from "@tanstack/query-core";
import type { Query, QueryFunction, QueryKey } from "@tanstack/query-core";
import { Clock, Context, Effect, Layer, PubSub, Stream } from "effect";

import { instantClock } from "@/lib/effect-clock";
import { withLogCategory } from "@/lib/effect-log";

/**
 * The answer one key holds, as one immutable snapshot: a surface reads a whole
 * state at one instant rather than watching a record change under it.
 *
 * `value` is what the last successful read committed. `status` says what the
 * read behind it is doing now — `revalidating` while a replacement runs,
 * `failed` when the last one errored, `fresh` otherwise. `settled` follows the
 * current or most recent read to the value it committed, or to `null` where it
 * committed none.
 */
export interface Held<T> {
  readonly value: T;
  readonly status: "fresh" | "revalidating" | "failed";
  readonly settled: Promise<T | null>;
}

/**
 * How long a key that failed is served from what it holds before the next ask
 * reads again. Query Core marks an errored query invalidated, so without the
 * pause a persistent fault — a broken style, a locked database — would re-run
 * its read on every redraw.
 */
export const FAILURE_COOLDOWN = Temporal.Duration.from({ seconds: 5 });

/** The attempt's outcome, retained before a display caller chooses a held value. */
type ReadResult<T> =
  | { kind: "value"; value: T }
  | { kind: "failed"; error: unknown; held: T | null; cooldown: boolean }
  | { kind: "cancelled"; held: T | null }
  | { kind: "released" };

/** What one key prefix's owner is told about the reads under it. */
export interface HeldReadEvents<T> {
  /** A read committed a value that is not the one the key held. */
  changed?: (key: QueryKey) => void;
  /** A read committed, including an equal or a failed one. */
  settled: (key: QueryKey, held: Held<T> | null) => void;
}

/** The last settlement, with its immutable Held Read snapshot. */
export interface HeldReadChange {
  readonly key: QueryKey;
  readonly held: Held<unknown> | null;
  readonly changed: boolean;
}

/**
 * Holds the plugin's one `QueryClient` — the engine every Held Read owner reads
 * and invalidates through, which serves the old answer while a fresh read
 * replaces it.
 *
 * Citation Lookup views observe their requested answers. The client attaches
 * no window-focus or online listener and is never mounted. Owners request
 * refreshes explicitly and set retention for their own key prefix.
 *
 * Owners namespace their keys, set their retention and their semantic equality
 * through {@link QueryClient.setQueryDefaults}, and drop what they hold through
 * {@link QueryClients}, which cancels the in-flight reads first
 * so a superseded read never publishes.
 */
export class QueryClients extends Context.Service<
  QueryClients,
  {
    readonly client: QueryClient;
    /** Each settlement, in order, from when the consumer attaches. */
    readonly changes: Stream.Stream<HeldReadChange>;
    invalidate(key: QueryKey): Effect.Effect<void>;
    update<T>(key: QueryKey, next: (held: T) => T): Effect.Effect<void>;
    keysUnder(prefix: QueryKey): Effect.Effect<QueryKey[]>;
    peek<T>(key: QueryKey): Effect.Effect<Held<T> | null>;
    ask<T>(
      key: QueryKey,
      queryFn: QueryFunction<T>,
    ): Effect.Effect<T | null, unknown>;
    read<T>(
      key: QueryKey,
      queryFn: QueryFunction<T>,
      signal?: AbortSignal,
    ): Effect.Effect<T | null, unknown>;
    readFresh<T>(
      key: QueryKey,
      queryFn: QueryFunction<T>,
      signal?: AbortSignal,
    ): Effect.Effect<T, unknown>;
    watch<T>(
      prefix: QueryKey,
      on: HeldReadEvents<T>,
    ): Effect.Effect<() => void>;
  }
>()("zotlit/query-client/QueryClients") {}

const makeQueryClients = Effect.gen(function* () {
  const now = instantClock(yield* Clock.Clock);
  const run = Effect.runSyncWith(yield* Effect.context<never>());
  let closed = false;
  const settlements = yield* PubSub.unbounded<HeldReadChange>();
  // Query Core's errorUpdatedAt uses wall time. Keep both ends of this
  // cooldown on the layer's Clock, including when that Clock starts at zero.
  const failures = new Map<string, number>();
  const watchers = new Set<() => void>();
  const client = yield* Effect.acquireRelease(
    Effect.sync(() => {
      // Waiting local mutations must also run while the window is hidden.
      focusManager.setFocused(true);
      return new QueryClient({
        defaultOptions: {
          queries: {
            // A held value goes stale by invalidation alone: an owner knows what
            // makes its reads stale, and no clock does.
            staleTime: Infinity,
            retry: false,
            // Every read is local — a vault file, a Zotero database, a Pandoc
            // render — so none of them waits for an online event.
            networkMode: "always",
            refetchOnWindowFocus: false,
            refetchOnReconnect: false,
          },
        },
      });
    }),
    (client) =>
      Effect.sync(() => {
        closed = true;
        client.clear();
      }),
  );

  /**
   * Marks stale what every key under one prefix holds, cancelling the reads
   * running for them first: Query Core commits an in-flight result and clears
   * the stale mark, so a read that answered the state before the drop would
   * otherwise stand as the current answer. Every reader of a cancelled read,
   * the one that started it and the ones that joined it alike, asks again.
   *
   * The drop also ends the failure cooldown of a key that errored: the caller
   * knows the inputs moved, so the next ask reads at once instead of waiting
   * out a pause meant for a fault that nothing has answered.
   *
   * @param queryKey the key, or the prefix of the keys, to mark stale.
   */
  const invalidate = Effect.fn("QueryClients.invalidate")(
    (queryKey: QueryKey) =>
      Effect.sync(() => {
        void client.cancelQueries({ queryKey }, { revert: true });
        void client.invalidateQueries({ queryKey, refetchType: "none" });
        for (const query of client.getQueryCache().findAll({ queryKey })) {
          failures.delete(query.queryHash);
          if (query.state.status === "error")
            query.setState({ errorUpdatedAt: 0 });
        }
      }),
  );

  /**
   * Replaces what one key holds, for an owner that learned the new value
   * without reading again — a write whose own answer already carries it.
   *
   * A key the cache holds nothing for is left alone: there is no value to
   * replace, and the first read of that key answers it.
   *
   * @param key the key whose held value moves.
   * @param next what the held value becomes.
   */
  const update = Effect.fn("QueryClients.update")(
    <T>(key: QueryKey, next: (held: T) => T) =>
      Effect.sync(() => {
        const query = client
          .getQueryCache()
          .find<T>({ queryKey: key, exact: true });
        if (query === undefined || query.state.data === undefined) return;
        client.setQueryData<T>(key, next(query.state.data));
      }),
  );

  /**
   * Every key under one prefix that the cache holds a read for, so an owner can
   * name what it just dropped without walking the cache itself.
   *
   * @param prefix the key prefix to enumerate.
   */
  const keysUnder = Effect.fn("QueryClients.keysUnder")((prefix: QueryKey) =>
    Effect.sync(() => {
      return client
        .getQueryCache()
        .findAll({ queryKey: prefix })
        .map((query) => query.queryKey);
    }),
  );

  /**
   * What one key holds right now, for a caller that cannot wait — an editor
   * builds its decorations synchronously.
   *
   * @returns null while no read has committed a value for the key.
   */
  function peekValue<T>(key: QueryKey): Held<T> | null {
    const query = client
      .getQueryCache()
      .find<T>({ queryKey: key, exact: true });
    if (query === undefined || query.state.data === undefined) return null;
    const { data, status, fetchStatus } = query.state;
    return {
      value: data,
      status:
        fetchStatus === "fetching"
          ? "revalidating"
          : status === "error"
            ? "failed"
            : "fresh",
      settled: settledValue(query),
    };
  }

  /**
   * Reads one key and joins a read already running for it, which is what makes
   * one read answer every surface that asks for the same key at once.
   *
   * A key whose last read errored is served from what it holds for
   * {@link FAILURE_COOLDOWN} without reading again. A read an invalidation
   * cancelled is asked once more, so a cancellation is never an answer.
   *
   * @returns the value the read committed, or null where it failed.
   */
  const ask = Effect.fn("QueryClients.ask")(function* <T>(
    key: QueryKey,
    queryFn: QueryFunction<T>,
  ): Effect.fn.Return<T | null, unknown> {
    const result = yield* settle(key, queryFn, undefined);
    if (result.kind === "value") return result.value;
    return result.kind === "failed" && result.cooldown ? result.held : null;
  });

  /**
   * Reads one key through to the value that stands, asking again where an
   * invalidation cancelled the read this joined, and answering a failed read
   * with what the key still holds — a surface keeps its last answer on screen
   * rather than dropping to nothing.
   *
   * @param signal aborts the wait, not the shared read: the read runs on for
   *   every other caller that joined it.
   * @returns the settled value, what the key still holds where the read failed,
   *   or null where it holds nothing.
   */
  const read = Effect.fn("QueryClients.read")(function* <T>(
    key: QueryKey,
    queryFn: QueryFunction<T>,
    signal?: AbortSignal,
  ): Effect.fn.Return<T | null, unknown> {
    const result = yield* settle(key, queryFn, signal);
    if (result.kind === "value") return result.value;
    return result.kind === "released" ? null : result.held;
  });

  /**
   * Reads a dependency for composition. A failed dependency stays failed in
   * the parent Held Read instead of committing stale input as fresh output.
   *
   * Shares joining, cooldown and cancellation with {@link read}; the original
   * error rejects even during cooldown. Removal or disposal rejects with
   * AbortError. The caller's signal ends its wait alone.
   */
  const readFresh = Effect.fn("QueryClients.readFresh")(function* <T>(
    key: QueryKey,
    queryFn: QueryFunction<T>,
    signal?: AbortSignal,
  ): Effect.fn.Return<T, unknown> {
    const result = yield* settle(key, queryFn, signal);
    if (result.kind === "value") return result.value;
    if (result.kind === "failed") return yield* Effect.fail(result.error);
    return yield* Effect.fail(
      new DOMException(`Held read ${result.kind}`, "AbortError"),
    );
  });

  /**
   * Reports what the reads under one key prefix commit, which is how an owner
   * rebuilds its own `changed` and `settled` events. Query Core delivers cache
   * events synchronously, so an owner re-emits them inline.
   *
   * @param prefix the key prefix whose reads this owner answers for.
   * @param on what each settlement under that prefix is reported through.
   * @returns the unsubscribe the owner holds for its lifetime.
   */
  const watch = Effect.fn("QueryClients.watch")(
    <T>(prefix: QueryKey, on: HeldReadEvents<T>) =>
      Effect.sync(() => {
        if (closed) return () => {};
        /** What each key held when its running read started, by query hash. */
        const holding = new Map<string, unknown>();
        const unsubscribe = client.getQueryCache().subscribe((event) => {
          if (!partialMatchKey(event.query.queryKey, prefix)) return;
          const { queryHash, queryKey } = event.query;
          if (event.type === "removed") {
            holding.delete(queryHash);
            return;
          }
          if (event.type !== "updated") return;
          switch (event.action.type) {
            case "fetch":
              holding.set(queryHash, event.query.state.data);
              return;
            case "success": {
              // Semantic equality is structural sharing, so an equal value is the
              // very value the key already held and changes nothing on screen.
              const held = holding.get(queryHash);
              holding.delete(queryHash);
              if (held !== event.query.state.data) on.changed?.(queryKey);
              on.settled(queryKey, peekValue<T>(queryKey));
              return;
            }
            case "error":
              holding.delete(queryHash);
              on.settled(queryKey, peekValue<T>(queryKey));
              return;
            default:
              return;
          }
        });
        const stop = () => {
          unsubscribe();
          watchers.delete(stop);
        };
        watchers.add(stop);
        return stop;
      }),
  );

  /**
   * One ask, and one more where an invalidation cancelled the read this joined:
   * that second ask reads what the invalidation asked for.
   *
   * Each attempt belongs to the same query lifetime. A later query using the
   * same key is a separate read, and disposal ends every lifetime.
   */
  const settle = Effect.fn("QueryClients.settle")(function* <T>(
    key: QueryKey,
    queryFn: QueryFunction<T>,
    signal: AbortSignal | undefined,
  ): Effect.fn.Return<ReadResult<T>, unknown> {
    if (closed) return { kind: "released" };
    const reading = attempt(key, queryFn, signal);
    const cache = client.getQueryCache();
    const query = cache.find({ queryKey: key, exact: true });
    const released = () =>
      closed || cache.find({ queryKey: key, exact: true }) !== query;
    const joined = yield* Effect.tryPromise({
      try: () => reading,
      catch: (error) => error,
    });
    if (released()) return { kind: "released" };
    if (joined.kind !== "cancelled") return joined;
    yield* Effect.logDebug("Held read cancelled, asking again").pipe(
      Effect.annotateLogs({ queryKey: key }),
    );
    const retried = yield* Effect.tryPromise({
      try: () => attempt(key, queryFn, signal),
      catch: (error) => error,
    });
    return released() ? { kind: "released" } : retried;
  }, withLogCategory("query-client"));

  /** One ask, raced against the caller's signal where it brought one. */
  function attempt<T>(
    key: QueryKey,
    queryFn: QueryFunction<T>,
    signal: AbortSignal | undefined,
  ): Promise<ReadResult<T>> {
    const reading = fetch(key, queryFn);
    return signal === undefined ? reading : abortable(reading, signal);
  }

  /**
   * One ask, with the failure cooldown in front of it.
   *
   * A read the client released — disposal, or a key removed because the file it
   * names is gone — is cancelled silently, and answers nothing rather than
   * arming an ask the released client would run again.
   *
   * Keeps failure and held data together so composition and display share the
   * same attempt without sharing their error policy.
   */
  function fetch<T>(
    key: QueryKey,
    queryFn: QueryFunction<T>,
  ): Promise<ReadResult<T>> {
    const query = client
      .getQueryCache()
      .find<T>({ queryKey: key, exact: true });
    const state = query?.state;
    const failedAt = query && failures.get(query.queryHash);
    if (
      state?.status === "error" &&
      failedAt !== undefined &&
      now().epochMilliseconds - failedAt <
        FAILURE_COOLDOWN.total("milliseconds")
    ) {
      run(
        Effect.logTrace("Failed held read served without a fresh one").pipe(
          Effect.annotateLogs({
            queryKey: key,
            held: state.data !== undefined,
          }),
          withLogCategory("query-client"),
        ),
      );
      return Promise.resolve({
        kind: "failed",
        error: state.error,
        held: state.data ?? null,
        cooldown: true,
      });
    }
    return client.fetchQuery<T>({ queryKey: key, queryFn }).then(
      // A read the invalidation reverted resolves with the value it reverted
      // to, and the stale mark it left is what tells that value apart from one
      // this read committed.
      () => {
        const settled = client.getQueryState<T>(key);
        if (settled === undefined) return { kind: "released" };
        return settled.isInvalidated
          ? { kind: "cancelled", held: settled.data ?? null }
          : { kind: "value", value: settled.data! };
      },
      (error: unknown) => {
        const held = client.getQueryData<T>(key) ?? null;
        if (!(error instanceof CancelledError))
          return { kind: "failed", error, held, cooldown: false };
        if (error.silent !== true) return { kind: "cancelled", held };
        run(
          Effect.logDebug("Held read released before it settled").pipe(
            Effect.annotateLogs({ queryKey: key }),
            withLogCategory("query-client"),
          ),
        );
        return { kind: "released" };
      },
    );
  }
  // Query Core emits synchronously. Capture the clock and snapshot before
  // handing a settlement to either the Stream or an inline legacy watcher.
  yield* Effect.acquireRelease(
    Effect.sync(() =>
      client.getQueryCache().subscribe((event) => {
        if (event.type === "removed") failures.delete(event.query.queryHash);
        if (event.type !== "updated") return;
        if (event.action.type === "error")
          failures.set(event.query.queryHash, now().epochMilliseconds);
        if (event.action.type === "success")
          failures.delete(event.query.queryHash);
      }),
    ),
    (unsubscribe) => Effect.sync(unsubscribe),
  );
  let changed = false;
  const stopChanges = yield* watch([], {
    changed: () => {
      changed = true;
    },
    settled: (key, held) => {
      const next = { key, held, changed };
      changed = false;
      run(PubSub.publish(settlements, next));
    },
  });
  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      closed = true;
      stopChanges();
      for (const stop of watchers) stop();
      failures.clear();
      yield* PubSub.shutdown(settlements);
    }),
  );

  const peek = Effect.fn("QueryClients.peek")(<T>(key: QueryKey) =>
    Effect.sync(() => {
      return peekValue<T>(key);
    }),
  );
  return QueryClients.of({
    client,
    changes: Stream.fromPubSub(settlements),
    invalidate,
    update,
    keysUnder,
    ask,
    read,
    readFresh,
    watch,
    peek,
  });
});

export const layerQueryClients = Layer.effect(QueryClients, makeQueryClients);

/** The current or most recent read of `query`, as the value it commits. */
function settledValue<T>(query: Query<T>): Promise<T | null> {
  const reading = query.promise;
  if (reading !== undefined)
    return reading.then(
      (value) => value,
      () => null,
    );
  return Promise.resolve(
    query.state.status === "error" ? null : (query.state.data ?? null),
  );
}
