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
 * - runs every search in one `FiberHandle`, so the next keystroke interrupts
 *   the request before it, and that interrupt reaches the worker;
 * - prewarms the index once on ready and on each Library Scope change.
 *
 * It answers empty while the scope is unresolved and when the database is
 * unavailable.
 */
import { Effect, FiberHandle, FiberSet, Scope } from "effect";

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

interface ItemLookupReady {
  /** Runs a search in the one search FiberHandle, interrupting the one before. */
  runSearch: (effect: Effect.Effect<SearchHit[]>) => Promise<SearchHit[]>;
}

export class ItemLookup extends Service<ItemLookupReady> {
  readonly #reads;
  readonly #libraryScope;
  /** The answer of the newest search the handle runs. */
  #latest: Promise<SearchHit[]> = Promise.resolve([]);

  ready: Promise<ItemLookupReady>;

  constructor(deps: ItemLookupDeps) {
    super();
    this.#reads = deps.reads;
    this.#libraryScope = deps.libraryScope;
    this.ready = this.#load();
  }

  /**
   * The Items in Library Scope that match `query`, best first, at most
   * `limit`. A later call interrupts this one, which then answers with the
   * later call's list, so a list drawn from either matches the newest query.
   */
  async search(query: string, opts?: { limit?: number }): Promise<SearchHit[]> {
    const { runSearch } = await this.ready;
    const limit = opts?.limit ?? DEFAULT_LIMIT;
    const libraries = this.#libraryScope.current?.available ?? [];
    if (limit <= 0 || libraries.length === 0) return [];
    const answer: Promise<SearchHit[]> = runSearch(
      this.#searchItems(libraries, query, limit),
    ).catch((error: unknown) => {
      // A newer search interrupted this one, or the search handle closed.
      logger.debug("Search interrupted", { error, queryLength: query.length });
      return this.#latest === answer ? [] : this.#latest;
    });
    this.#latest = answer;
    return answer;
  }

  async #load(): Promise<ItemLookupReady> {
    await using stack = new AsyncDisposableStack();
    const { scope, close } = openScope();
    stack.defer(close);
    const searches = Effect.runSync(
      Scope.provide(FiberHandle.make<SearchHit[], never>(), scope),
    );
    const runSearch = Effect.runSync(FiberHandle.runtimePromise(searches)());
    const runPrewarm = Effect.runSync(
      Scope.provide(FiberSet.makeRuntime<never, void, never>(), scope),
    );
    const prewarm = (resolved: ResolvedLibraryScope | null) => {
      const libraries = resolved?.available ?? [];
      if (libraries.length === 0) return;
      runPrewarm(Effect.asVoid(this.#searchItems(libraries, "", 1)));
    };
    let scopeKey = scopeKeyOf(this.#libraryScope.current);
    stack.defer(
      this.#libraryScope.on("changed", (resolved) => {
        // A pending answer covers the Libraries it asked with; once those
        // change, it must not reach a picker. A rename keeps it.
        const next = scopeKeyOf(resolved);
        if (next !== scopeKey) {
          scopeKey = next;
          Effect.runFork(FiberHandle.clear(searches));
        }
        prewarm(resolved);
      }),
    );

    this.commit(stack.move());

    await Promise.all([this.#reads.ready, this.#libraryScope.ready]);
    logger.info("Item lookup ready");
    scopeKey = scopeKeyOf(this.#libraryScope.current);
    prewarm(this.#libraryScope.current);
    return { runSearch };
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
