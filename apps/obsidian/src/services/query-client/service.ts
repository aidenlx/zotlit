// The one query client every Held Read is realized on, and the Held Read projection of a query's state.

import { abortable } from "@std/async/abortable";
import {
  CancelledError,
  partialMatchKey,
  QueryClient,
} from "@tanstack/query-core";
import type { Query, QueryFunction, QueryKey } from "@tanstack/query-core";

import { getLogger } from "@/lib/log";
import { Service } from "@/services/service-base";

const logger = getLogger("query-client");

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

/** A read that an invalidation cancelled, which the asker resolves again. */
const CANCELLED = Symbol("cancelled");

/** What one key prefix's owner is told about the reads under it. */
interface HeldReadEvents<T> {
  /** A read committed a value that is not the one the key held. */
  changed?: (key: QueryKey) => void;
  /** A read committed, including an equal or a failed one. */
  settled: (key: QueryKey, held: Held<T> | null) => void;
}

export interface QueryClientServiceDeps {
  /** The clock the failure cooldown is read against. */
  now?: () => Temporal.Instant;
}

/**
 * Holds the plugin's one `QueryClient` — the engine every Held Read owner reads
 * and invalidates through, which serves the old answer while a fresh read
 * replaces it.
 *
 * Reads are asked for, never observed: no surface holds a query observer, so the
 * client attaches no window-focus or online listener and is never mounted. Every
 * read is therefore explicit, and retention is the garbage-collection time each
 * owner sets for its own key prefix.
 *
 * Owners namespace their keys, set their retention and their semantic equality
 * through {@link QueryClient.setQueryDefaults}, and drop what they hold through
 * {@link QueryClientService.invalidate}, which cancels the in-flight reads first
 * so a superseded read never publishes.
 */
export class QueryClientService extends Service {
  readonly #now;
  readonly #client = new QueryClient({
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

  ready: Promise<void>;

  constructor({
    now = () => Temporal.Now.instant(),
  }: QueryClientServiceDeps = {}) {
    super();
    this.#now = now;
    this.ready = this.#load();
  }

  /** The client itself, for the defaults and the removals an owner runs. */
  get client(): QueryClient {
    return this.#client;
  }

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
  invalidate(queryKey: QueryKey): void {
    void this.#client.cancelQueries({ queryKey }, { revert: true });
    void this.#client.invalidateQueries({ queryKey, refetchType: "none" });
    for (const query of this.#client.getQueryCache().findAll({ queryKey })) {
      if (query.state.status === "error") query.setState({ errorUpdatedAt: 0 });
    }
  }

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
  update<T>(key: QueryKey, next: (held: T) => T): void {
    const query = this.#client
      .getQueryCache()
      .find<T>({ queryKey: key, exact: true });
    if (query === undefined || query.state.data === undefined) return;
    this.#client.setQueryData<T>(key, next(query.state.data));
  }

  /**
   * Every key under one prefix that the cache holds a read for, so an owner can
   * name what it just dropped without walking the cache itself.
   *
   * @param prefix the key prefix to enumerate.
   */
  keysUnder(prefix: QueryKey): QueryKey[] {
    return this.#client
      .getQueryCache()
      .findAll({ queryKey: prefix })
      .map((query) => query.queryKey);
  }

  /**
   * What one key holds right now, for a caller that cannot wait — an editor
   * builds its decorations synchronously.
   *
   * @returns null while no read has committed a value for the key.
   */
  peek<T>(key: QueryKey): Held<T> | null {
    const query = this.#client
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
  async ask<T>(key: QueryKey, queryFn: QueryFunction<T>): Promise<T | null> {
    const value = await this.#settle(key, queryFn, undefined);
    return value === CANCELLED ? null : value;
  }

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
  async read<T>(
    key: QueryKey,
    queryFn: QueryFunction<T>,
    signal?: AbortSignal,
  ): Promise<T | null> {
    const value = await this.#settle(key, queryFn, signal);
    if (value !== null && value !== CANCELLED) return value;
    return this.peek<T>(key)?.value ?? null;
  }

  /**
   * Reports what the reads under one key prefix commit, which is how an owner
   * rebuilds its own `changed` and `settled` events. Query Core delivers cache
   * events synchronously, so an owner re-emits them inline.
   *
   * @param prefix the key prefix whose reads this owner answers for.
   * @param on what each settlement under that prefix is reported through.
   * @returns the unsubscribe the owner holds for its lifetime.
   */
  watch<T>(prefix: QueryKey, on: HeldReadEvents<T>): () => void {
    /** What each key held when its running read started, by query hash. */
    const holding = new Map<string, unknown>();
    return this.#client.getQueryCache().subscribe((event) => {
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
          on.settled(queryKey, this.peek<T>(queryKey));
          return;
        }
        case "error":
          holding.delete(queryHash);
          on.settled(queryKey, this.peek<T>(queryKey));
          return;
        default:
          return;
      }
    });
  }

  async #load(): Promise<void> {
    await using stack = new AsyncDisposableStack();
    // Clearing cancels every in-flight read and releases every held value.
    stack.adopt(this.#client, (client) => {
      client.clear();
    });

    this.commit(stack.move());
  }

  /**
   * One ask, and one more where an invalidation cancelled the read this joined:
   * that second ask reads what the invalidation asked for.
   *
   * @returns the committed value, null where the read failed or the client
   *   released it, or {@link CANCELLED} where the second ask was cancelled too.
   */
  async #settle<T>(
    key: QueryKey,
    queryFn: QueryFunction<T>,
    signal: AbortSignal | undefined,
  ): Promise<T | null | typeof CANCELLED> {
    const joined = await this.#attempt(key, queryFn, signal);
    if (joined !== CANCELLED) return joined;
    logger.debug("Held read cancelled, asking again", { queryKey: key });
    return await this.#attempt(key, queryFn, signal);
  }

  /** One ask, raced against the caller's signal where it brought one. */
  #attempt<T>(
    key: QueryKey,
    queryFn: QueryFunction<T>,
    signal: AbortSignal | undefined,
  ): Promise<T | null | typeof CANCELLED> {
    const reading = this.#fetch(key, queryFn);
    return signal === undefined ? reading : abortable(reading, signal);
  }

  /**
   * One ask, with the failure cooldown in front of it.
   *
   * A read the client released — disposal, or a key removed because the file it
   * names is gone — is cancelled silently, and answers nothing rather than
   * arming an ask the released client would run again.
   *
   * @returns the committed value, null where the read failed or was released,
   *   or {@link CANCELLED} where an invalidation superseded it.
   */
  #fetch<T>(
    key: QueryKey,
    queryFn: QueryFunction<T>,
  ): Promise<T | null | typeof CANCELLED> {
    const state = this.#client.getQueryState<T>(key);
    if (
      state?.status === "error" &&
      this.#now().epochMilliseconds - state.errorUpdatedAt <
        FAILURE_COOLDOWN.total("milliseconds")
    ) {
      logger.trace("Failed held read served without a fresh one", {
        queryKey: key,
        held: state.data !== undefined,
      });
      return Promise.resolve(state.data ?? null);
    }
    return this.#client.fetchQuery<T>({ queryKey: key, queryFn }).then(
      // A read the invalidation reverted resolves with the value it reverted
      // to, and the stale mark it left is what tells that value apart from one
      // this read committed.
      (value) =>
        this.#client.getQueryState(key)?.isInvalidated === true
          ? CANCELLED
          : value,
      (error: unknown) => {
        if (!(error instanceof CancelledError)) return null;
        if (error.silent !== true) return CANCELLED;
        logger.debug("Held read released before it settled", { queryKey: key });
        return null;
      },
    );
  }
}

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
