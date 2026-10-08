// The renderer's Item search facade over the ZoteroReads SearchItems operation.
/**
 * The renderer's Item search: a thin facade over the ZoteroReads `SearchItems`
 * operation. The worker owns the Item Index (building, refresh, scope
 * identity); this facade only
 *
 * - resolves the current Library Scope to local `libraryIDs`, in canonical
 *   order, and asks `SearchItems`;
 * - labels each hit with its Library from the scope it asked with, when two
 *   or more Libraries are in scope, so a group rename shows without a rebuild;
 * - runs the searches of each Search Session in one `FiberHandle`, so the
 *   next keystroke on a search surface interrupts the request before it, and
 *   that interrupt reaches the worker; one-shot searches run beside them;
 * - prewarms the index once on ready and on each Library Scope change.
 *
 * It answers empty while the scope is unresolved and when the database is
 * unavailable.
 */
import { Effect, Exit, FiberHandle, FiberSet, Scope } from "effect";

import { openScope } from "@/lib/effect-scope";
import { getLogger } from "@/lib/log";
import { selectorKey } from "@/services/library-scope/scope";
import type {
  AvailableLibrary,
  ResolvedLibraryScope,
} from "@/services/library-scope/scope";
import type { LibraryScopeService } from "@/services/library-scope/service";
import { Service } from "@/services/service-base";
import type { SearchHit as ReadsSearchHit } from "@/services/zotero-reads/rpc";
import type { ZoteroReadsService } from "@/services/zotero-reads/service";

const logger = getLogger(["item-lookup"]);
export const DEFAULT_LIMIT = 50;

export interface SearchHit extends ReadsSearchHit {
  /**
   * The Library this hit came from, for a muted label on the result row, or
   * `null` when one Library is available and the label would say nothing.
   */
  library: AvailableLibrary | null;
}

export interface ItemLookupDeps {
  reads: Pick<ZoteroReadsService, "ready">;
  libraryScope: Pick<LibraryScopeService, "ready" | "on" | "current">;
}

/**
 * The searches of one search surface, such as a picker or the Citation
 * Suggester. A later `search` interrupts the one before; `close` (or dispose)
 * interrupts the pending search, and every later `search` answers empty.
 */
export interface SearchSession extends Disposable {
  search(query: string, opts?: { limit?: number }): Promise<SearchHit[]>;
  close(): void;
}

type RunSearch = (effect: Effect.Effect<SearchHit[]>) => Promise<SearchHit[]>;

interface ItemLookupReady {
  /** Runs a one-shot search in the FiberSet, beside every other search. */
  runOnce: RunSearch;
  /** Opens a FiberHandle of its own for one session; `close` ends it. */
  openHandle: () => { run: RunSearch; close: () => void };
}

export class ItemLookup extends Service<ItemLookupReady> {
  readonly #reads;
  readonly #libraryScope;
  ready: Promise<ItemLookupReady>;

  constructor(deps: ItemLookupDeps) {
    super();
    this.#reads = deps.reads;
    this.#libraryScope = deps.libraryScope;
    this.ready = this.#load();
  }

  /**
   * The Items in Library Scope that match `query`, best first, at most
   * `limit`: a one-shot search, which runs beside every other search. A
   * Library Scope change that changes the Libraries interrupts it, and it
   * then answers empty.
   */
  async search(query: string, opts?: { limit?: number }): Promise<SearchHit[]> {
    const { runOnce } = await this.ready;
    return this.#run(runOnce, query, opts).catch((error: unknown) => {
      // A scope change interrupted this search, or the service closed.
      logger.debug("Search interrupted", { error, queryLength: query.length });
      return [];
    });
  }

  /**
   * A Search Session for one search surface: its searches run in one
   * `FiberHandle`, so a later call interrupts the one before, which then
   * answers with the later call's list. Searches of other sessions and
   * one-shot searches run beside it. After `close`, a search answers empty.
   */
  openSession(): SearchSession {
    const handle = this.ready.then(({ openHandle }) => openHandle());
    let closed = false;
    /** The answer of the newest search the session runs. */
    let latest: Promise<SearchHit[]> = Promise.resolve([]);
    const close = () => {
      if (closed) return;
      closed = true;
      void handle.then(
        (opened) => opened.close(),
        () => undefined,
      );
    };
    return {
      search: async (query, opts) => {
        const { run } = await handle;
        if (closed) return [];
        const answer: Promise<SearchHit[]> = this.#run(run, query, opts).catch(
          (error: unknown) => {
            // A newer search interrupted this one, or the session closed.
            logger.debug("Search interrupted", {
              error,
              queryLength: query.length,
            });
            return latest === answer ? [] : latest;
          },
        );
        latest = answer;
        return answer;
      },
      close,
      [Symbol.dispose]: close,
    };
  }

  /** Runs one search through `run`; answers empty without a request when the limit or the scope leaves nothing to ask. */
  async #run(
    run: RunSearch,
    query: string,
    opts: { limit?: number } | undefined,
  ): Promise<SearchHit[]> {
    const limit = opts?.limit ?? DEFAULT_LIMIT;
    const libraries = this.#libraryScope.current?.available ?? [];
    if (limit <= 0 || libraries.length === 0) return [];
    return run(this.#searchItems(libraries, query, limit));
  }

  async #load(): Promise<ItemLookupReady> {
    await using stack = new AsyncDisposableStack();
    const { scope, close } = openScope();
    stack.defer(close);
    const oneShots = Effect.runSync(
      Scope.provide(FiberSet.make<SearchHit[], never>(), scope),
    );
    const runOnce = Effect.runSync(FiberSet.runtimePromise(oneShots)());
    const runPrewarm = Effect.runSync(
      Scope.provide(FiberSet.makeRuntime<never, void, never>(), scope),
    );
    const prewarm = (resolved: ResolvedLibraryScope | null) => {
      const libraries = resolved?.available ?? [];
      if (libraries.length === 0) return;
      runPrewarm(Effect.asVoid(this.#searchItems(libraries, "", 1)));
    };
    const sessions = new Set<FiberHandle.FiberHandle<SearchHit[], never>>();
    const openHandle = () => {
      const sessionScope = Scope.forkUnsafe(scope);
      const handle = Effect.runSync(
        Scope.provide(FiberHandle.make<SearchHit[], never>(), sessionScope),
      );
      sessions.add(handle);
      return {
        run: Effect.runSync(FiberHandle.runtimePromise(handle)()),
        close: () => {
          sessions.delete(handle);
          void Effect.runPromise(Scope.close(sessionScope, Exit.void));
        },
      };
    };
    let scopeKey = scopeKeyOf(this.#libraryScope.current);
    stack.defer(
      this.#libraryScope.on("changed", (resolved) => {
        // A pending answer covers the Libraries it asked with; once those
        // change, it must not reach a picker. A rename keeps it.
        const next = scopeKeyOf(resolved);
        if (next !== scopeKey) {
          scopeKey = next;
          Effect.runFork(
            Effect.all(
              [
                FiberSet.clear(oneShots),
                ...[...sessions].map(FiberHandle.clear),
              ],
              { discard: true },
            ),
          );
        }
        prewarm(resolved);
      }),
    );

    this.commit(stack.move());

    await Promise.all([this.#reads.ready, this.#libraryScope.ready]);
    logger.info("Item lookup ready");
    scopeKey = scopeKeyOf(this.#libraryScope.current);
    prewarm(this.#libraryScope.current);
    return { runOnce, openHandle };
  }

  /** One `SearchItems` request over `libraries`, labelled from them. */
  #searchItems(
    libraries: readonly AvailableLibrary[],
    query: string,
    limit: number,
  ): Effect.Effect<SearchHit[]> {
    // One available Library makes every label identical, so the rows carry none.
    const labels =
      libraries.length > 1
        ? new Map(libraries.map((library) => [library.libraryID, library]))
        : null;
    const t0 = performance.now();
    return Effect.promise(() => this.#reads.ready).pipe(
      Effect.flatMap(({ reads }) =>
        reads.SearchItems({
          libraryIDs: libraries.map((library) => library.libraryID),
          query,
          limit,
        }),
      ),
      Effect.map((hits) => {
        logger.debug("Search completed", {
          libraries: libraries.length,
          queryLength: query.length,
          hits: hits.length,
          durationMs: performance.now() - t0,
        });
        return hits.map(
          (hit): SearchHit => ({
            ...hit,
            library: labels?.get(hit.item.libraryID) ?? null,
          }),
        );
      }),
      Effect.catchTag("DbUnavailable", (error) =>
        Effect.sync(() => {
          logger.debug("Search answered empty; database unavailable", {
            error,
          });
          return [];
        }),
      ),
      // A search answers; a failure of any other kind is logged, not thrown.
      Effect.catch((error) => this.#logFailure(error)),
      Effect.catchDefect((defect) => this.#logFailure(defect)),
    );
  }

  #logFailure(error: unknown): Effect.Effect<SearchHit[]> {
    return Effect.sync(() => {
      logger.error("Search failed", { error });
      return [];
    });
  }
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
