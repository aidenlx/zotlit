// The renderer's Item search facade over the ZoteroReads SearchItems operation.
/**
 * The renderer's Item search: a thin facade over the ZoteroReads `SearchItems`
 * operation. The worker owns the Item Index (building, refresh, scope
 * identity); this facade only
 *
 * - resolves the current Library Scope to local `libraryIDs`, in canonical
 *   order, and asks `SearchItems`; a search may name its own Libraries;
 * - labels each hit with its Library from the scope it asked with, when two
 *   or more Libraries are in scope, so a group rename shows without a rebuild;
 * - runs the searches of each Search Session in one `FiberHandle`, so the
 *   next keystroke on a search surface interrupts the request before it, and
 *   that interrupt reaches the worker; one-shot searches run beside them;
 * - prewarms the index once on start and on each Library Scope change.
 *
 * It answers empty while the scope is unresolved and when the database is
 * unavailable.
 */
import {
  Clock,
  Context,
  Deferred,
  Effect,
  Exit,
  Fiber,
  FiberHandle,
  FiberSet,
  Layer,
  Scope,
} from "effect";

import { withLogCategory } from "@/lib/effect-log";
import { forkEach } from "@/lib/effect-stream";
import { selectorKey } from "@/services/library-scope/scope";
import type {
  AvailableLibrary,
  ResolvedLibraryScope,
} from "@/services/library-scope/scope";
import { LibraryScope, scopeChanges } from "@/services/library-scope/service";
import { UseLedger } from "@/services/use-ledger/service";
import type { SearchHit as ReadsSearchHit } from "@/services/zotero-reads/rpc";
import { ZoteroReads } from "@/services/zotero-reads/service";

export const DEFAULT_LIMIT = 50;

export interface SearchOptions {
  /** The most hits; {@link DEFAULT_LIMIT} where absent. */
  limit?: number;
  /** The Libraries to search in place of the Library Scope in force. */
  libraries?: readonly AvailableLibrary[];
  /** Indexed Keys to label as cited and put first in empty queries. */
  cited?: readonly string[];
}

export interface SearchHit extends ReadsSearchHit {
  /**
   * The Library this hit came from, for a muted label on the result row, or
   * `null` when one Library is available and the label would say nothing.
   */
  library: AvailableLibrary | null;
  cited: boolean;
}

/**
 * The searches of one search surface, such as a picker or the Citation
 * Suggester. A later `search` interrupts the one before, which then answers
 * with the later search's list. Closing the session's Scope interrupts the
 * pending search, and every later `search` answers empty.
 */
export interface ItemLookupSession {
  search(query: string, opts?: SearchOptions): Effect.Effect<SearchHit[]>;
}

export class ItemLookup extends Context.Service<
  ItemLookup,
  {
    /**
     * The Items in Library Scope, or in the Libraries `opts` names, that
     * match `query`, best first, at most `limit`: a one-shot search, which
     * runs beside every other search. A Library Scope change that changes
     * the Libraries interrupts it, and it then answers empty.
     */
    search(query: string, opts?: SearchOptions): Effect.Effect<SearchHit[]>;
    /**
     * A Search Session for one search surface, open until the caller's Scope
     * closes. Searches of other sessions and one-shot searches run beside it.
     */
    readonly openSession: Effect.Effect<ItemLookupSession, never, Scope.Scope>;
  }
>()("zotlit/item-lookup/ItemLookup") {}

const logInterrupted = (query: string) =>
  Effect.logDebug("Search interrupted").pipe(
    Effect.annotateLogs({ queryLength: query.length }),
  );

/**
 * A search fiber starts on the next turn, once its set or handle holds it: a
 * fiber that starts at once can wake a caller that searches again before the
 * handle knows the fiber to interrupt.
 */
const deferredStart = { startImmediately: false } as const;

/** How `fiber` ended; interrupting the caller interrupts `fiber`. */
const awaitSearch = (fiber: Fiber.Fiber<SearchHit[]>) =>
  Fiber.await(fiber).pipe(Effect.onInterrupt(() => Fiber.interrupt(fiber)));

export const layerItemLookup = Layer.effect(
  ItemLookup,
  Effect.gen(function* () {
    const { reads } = yield* ZoteroReads;
    const libraryScope = yield* LibraryScope;
    const useLedger = yield* UseLedger;
    const scope = yield* Scope.Scope;
    const oneShots = yield* FiberSet.make<SearchHit[]>();
    const prewarms = yield* FiberSet.make<void>();
    const sessions = new Set<FiberHandle.FiberHandle<SearchHit[]>>();

    /** One `SearchItems` request over `libraries`, labelled from them. */
    const searchItems = (
      libraries: readonly AvailableLibrary[],
      query: string,
      { limit, cited }: { limit: number; cited?: readonly string[] },
    ): Effect.Effect<SearchHit[]> =>
      Effect.gen(function* () {
        // One available Library makes every label identical, so the rows carry none.
        const labels =
          libraries.length > 1
            ? new Map(libraries.map((library) => [library.libraryID, library]))
            : null;
        const citedKeys = new Set(cited);
        const t0 = yield* Clock.currentTimeMillis;
        const hits = yield* reads.SearchItems({
          libraryIDs: libraries.map((library) => library.libraryID),
          query,
          limit,
          ...(query.trim() === ""
            ? { uses: yield* useLedger.uses, ...(cited ? { cited } : {}) }
            : {}),
        });
        yield* Effect.logDebug("Search completed").pipe(
          Effect.annotateLogs({
            libraries: libraries.length,
            queryLength: query.length,
            hits: hits.length,
            durationMs: (yield* Clock.currentTimeMillis) - t0,
          }),
        );
        return hits.map((hit): SearchHit => ({
          ...hit,
          library: labels?.get(hit.item.libraryID) ?? null,
          cited: citedKeys.has(hit.item.indexedKey),
        }));
      }).pipe(
        Effect.catchTag("DbUnavailable", (error) =>
          Effect.logDebug("Search answered empty; database unavailable").pipe(
            Effect.annotateLogs({ error }),
            Effect.as([]),
          ),
        ),
        // A search answers; a failure of any other kind is logged, not thrown.
        Effect.catch((error) => logFailure(error)),
        Effect.catchDefect((defect) => logFailure(defect)),
        withLogCategory("item-lookup"),
      );

    /**
     * The request of a search, or none when the limit or the scope leaves
     * nothing to ask: the search then answers empty.
     */
    const requestOf = (
      query: string,
      opts: SearchOptions | undefined,
    ): Effect.Effect<Effect.Effect<SearchHit[]> | undefined> =>
      Effect.map(libraryScope.current, (current) => {
        const limit = opts?.limit ?? DEFAULT_LIMIT;
        const libraries = opts?.libraries ?? current?.available ?? [];
        if (limit <= 0 || libraries.length === 0) return undefined;
        return searchItems(libraries, query, { limit, cited: opts?.cited });
      });

    const prewarm = (resolved: ResolvedLibraryScope | null) => {
      const libraries = resolved?.available ?? [];
      if (libraries.length === 0) return Effect.void;
      return FiberSet.run(
        prewarms,
        Effect.asVoid(searchItems(libraries, "", { limit: 1 })),
      ).pipe(Effect.asVoid);
    };

    const search = Effect.fn("ItemLookup.search")(function* (
      query: string,
      opts?: SearchOptions,
    ) {
      const request = yield* requestOf(query, opts);
      if (request === undefined) return [];
      const exit = yield* awaitSearch(
        yield* FiberSet.run(oneShots, request, deferredStart),
      );
      if (Exit.isSuccess(exit)) return exit.value;
      // A scope change interrupted this search, or the service closed.
      yield* logInterrupted(query);
      return [];
    }, withLogCategory("item-lookup"));

    const openSession = Effect.gen(function* () {
      const sessionScope = yield* Scope.fork(scope);
      yield* Effect.addFinalizer(() => Scope.close(sessionScope, Exit.void));
      const handle = yield* FiberHandle.make<SearchHit[]>().pipe(
        Scope.provide(sessionScope),
      );
      let closed = false;
      sessions.add(handle);
      // Added after the handle, so it runs before the handle closes.
      yield* Scope.addFinalizer(
        sessionScope,
        Effect.sync(() => {
          closed = true;
          sessions.delete(handle);
        }),
      );
      /** The answer of the newest search the session runs. */
      let latest: Deferred.Deferred<SearchHit[]> | undefined;
      const session: ItemLookupSession = {
        search: Effect.fn("ItemLookup.session.search")(function* (
          query: string,
          opts?: SearchOptions,
        ) {
          if (closed) return [];
          const request = yield* requestOf(query, opts);
          const answer = yield* Deferred.make<SearchHit[]>();
          latest = answer;
          const settled = yield* Effect.gen(function* () {
            if (request === undefined) return [];
            const exit = yield* awaitSearch(
              yield* FiberHandle.run(handle, request, deferredStart),
            );
            if (Exit.isSuccess(exit)) return exit.value;
            // A newer search interrupted this one, or the session closed.
            yield* logInterrupted(query);
            const newest = latest;
            return newest === answer || newest === undefined
              ? []
              : yield* Deferred.await(newest);
          }).pipe(Effect.onInterrupt(() => Deferred.succeed(answer, [])));
          yield* Deferred.succeed(answer, settled);
          return settled;
        }, withLogCategory("item-lookup")),
      };
      return session;
    }).pipe(Effect.withSpan("ItemLookup.openSession"));

    let scopeKey = scopeKeyOf(yield* libraryScope.current);
    yield* forkEach(scopeChanges(libraryScope.changes), ({ current }) =>
      Effect.gen(function* () {
        // A pending answer covers the Libraries it asked with; once those
        // change, it must not reach a picker. A rename keeps it.
        const next = scopeKeyOf(current);
        if (next !== scopeKey) {
          scopeKey = next;
          // The interrupts go out now; their cleanup does not hold the prewarm.
          yield* Effect.forkIn(
            Effect.all(
              [
                FiberSet.clear(oneShots),
                ...[...sessions].map(FiberHandle.clear),
              ],
              { discard: true },
            ),
            scope,
            { startImmediately: true },
          );
        }
        yield* prewarm(current);
      }),
    );

    yield* Effect.logInfo("Item lookup ready");
    yield* prewarm(yield* libraryScope.current);
    return ItemLookup.of({ search, openSession });
  }).pipe(withLogCategory("item-lookup")),
);

function logFailure(error: unknown): Effect.Effect<SearchHit[]> {
  return Effect.logError("Search failed").pipe(
    Effect.annotateLogs({ error }),
    Effect.as([]),
  );
}

/**
 * The Libraries `resolved` covers, as one comparable value: each stable
 * selector with its local id, since a database switch can give a local id to
 * another group.
 */
function scopeKeyOf(resolved: ResolvedLibraryScope | null): string {
  return (resolved?.available ?? [])
    .map((library) => `${selectorKey(library.selector)}@${library.libraryID}`)
    .join(",");
}
