/**
 * Search-index lifecycle for the Library Scope, kept fresh with a
 * stale-while-revalidate (SWR) rebuild model:
 *
 * - One **composite index** spans every available Library in scope. Per-Library
 *   BM25 scores are not comparable, so they are never merged: the whole corpus
 *   is indexed together and ranked once, globally.
 * - A database refresh (`reads.on("changed")`) rebuilds in the background while
 *   {@link ItemLookup.search} keeps serving the cached index — search never
 *   blocks on a rebuild, so frequent Zotero writes don't freeze suggestions.
 * - A change-gate reads a cheap per-Library `(count, checksum)`
 *   {@link IndexSignature} **vector** first and skips the rebuild when nothing
 *   indexed moved in any covered Library.
 * - Rebuilds are single-flight with a trailing rerun ({@link #scheduleRebuild}):
 *   a refresh arriving mid-build lets the build finish, then reruns once, so a
 *   burst of refreshes converges instead of restarting.
 * - Each rebuild pins one Snapshot ({@link ZoteroReadsService.snapshot}) for
 *   its scope resolution, its signature reads, and its item stream, so the
 *   cached signatures are atomic with the index they label and a concurrent
 *   refresh cannot tear slices across database states. The build reads one
 *   Library at a time from the `IndexItems` stream;
 *   {@link SearchIndexBuilder.build} then imposes the global order over the
 *   whole corpus.
 *
 * A Library Scope change is a hard invalidation: the new build replaces the
 * running one in the build FiberHandle, which interrupts it, and search hydration
 * bound to the old scope is dropped. The cache goes too, so the new scope
 * builds from scratch. A group rename leaves the covered Libraries alone, so it
 * refreshes labels without rebuilding.
 *
 * No fixed Library or Item limit applies.
 */
import { Effect, Exit, Fiber, FiberHandle, Scope, Stream } from "effect";
import { getLanguage } from "obsidian";

import { createLanguageLookup } from "@zotlit/db";
import type { IndexedItem, IndexSignature, Item } from "@zotlit/db";
import { createIndexBuilder, searchIndex } from "@zotlit/item-lookup";
import type {
  ChsSegmenter,
  SearchHit as EngineSearchHit,
  SearchIndex,
  TokenizerOptions,
} from "@zotlit/item-lookup";

import { getLogger } from "@/lib/log";
import { availableKey } from "@/services/library-scope/scope";
import type {
  AvailableLibrary,
  ResolvedLibraryScope,
} from "@/services/library-scope/scope";
import type { LibraryScopeService } from "@/services/library-scope/service";
import { Service } from "@/services/service-base";
import { DbUnavailable } from "@/services/zotero-reads/rpc";
import type {
  ZoteroReadsApi,
  ZoteroReadsService,
} from "@/services/zotero-reads/service";

const logger = getLogger(["item-lookup"]);
export const DEFAULT_LIMIT = 50;

export interface SearchHit extends EngineSearchHit<Item> {
  /**
   * The Library this hit came from, for a muted label on the result row, or
   * `null` when one Library is available and the label would say nothing.
   */
  library: AvailableLibrary | null;
}

export interface ItemLookupDeps {
  reads: ZoteroReadsService;
  libraryScope: Pick<
    LibraryScopeService,
    "ready" | "on" | "current" | "resolveLibraries"
  >;
  getChsSegmenter?: () => ChsSegmenter | null;
}

interface ItemLookupReady {
  /** Holds the running build; a build run in it interrupts the one before. */
  builds: FiberHandle.FiberHandle<void, never>;
}

interface ItemCache {
  /** Identity of the Libraries this index covers; see {@link availableKey}. */
  scopeKey: string;
  /** Those Libraries, in canonical order — the source of result labels. */
  libraries: readonly AvailableLibrary[];
  index: SearchIndex;
  /** One signature per covered Library, in the same canonical order. */
  signatures: readonly IndexSignature[];
}

function signaturesEqual(
  a: readonly IndexSignature[],
  b: readonly IndexSignature[],
): boolean {
  return (
    a.length === b.length &&
    a.every(
      (signature, index) =>
        signature.count === b[index]!.count &&
        signature.checksum === b[index]!.checksum,
    )
  );
}

export class ItemLookup extends Service<ItemLookupReady> {
  readonly #reads;
  readonly #libraryScope;
  readonly #languageLookup;
  readonly #getChsSegmenter;

  #cache: ItemCache | null = null;
  #rebuildInFlight: Promise<void> | null = null;
  #rebuildAgain = false;
  /** Libraries the index should cover, or `null` while the scope is unresolved. */
  #scopeKey: string | null = null;
  readonly #intl = new Intl.Segmenter(undefined, { granularity: "word" });
  #tokenizerOpts: TokenizerOptions;

  ready: Promise<ItemLookupReady>;

  constructor(deps: ItemLookupDeps) {
    super();
    this.#reads = deps.reads;
    this.#libraryScope = deps.libraryScope;
    this.#languageLookup = createLanguageLookup(getLanguage());
    this.#getChsSegmenter = deps.getChsSegmenter ?? (() => null);
    this.#tokenizerOpts = this.#createTokenizerOpts();
    this.ready = this.#load();
  }

  async search(query: string, opts?: { limit?: number }): Promise<SearchHit[]> {
    await this.ready;

    const limit = opts?.limit ?? DEFAULT_LIMIT;
    if (limit <= 0) return [];

    const t0 = performance.now();
    const cache = await this.#loadIfNeeded();
    if (!cache) {
      logger.debug("Search skipped; no index available", {
        queryLength: query.length,
      });
      return [];
    }

    const trimmed = query.trim();
    // `index.items` is already in global most-recently-modified order, so the
    // empty query is that order truncated to the limit.
    const leanHits =
      trimmed.length === 0
        ? cache.index.items.slice(0, limit).map((item) => ({
            item,
            score: 0,
            matches: [],
          }))
        : searchIndex(cache.index, trimmed, {
            tokenizer: this.#tokenizerOpts,
            limit,
          });
    const hits = await this.#hydrateHits(cache, leanHits);

    logger.debug("Search completed", {
      libraries: cache.libraries.length,
      queryLength: trimmed.length,
      hits: hits.length,
      durationMs: performance.now() - t0,
    });
    return hits;
  }

  async #load(): Promise<ItemLookupReady> {
    await using stack = new AsyncDisposableStack();
    const buildScope = Effect.runSync(Scope.make());
    stack.defer(() => Effect.runPromise(Scope.close(buildScope, Exit.void)));
    const builds = Effect.runSync(
      Scope.provide(FiberHandle.make<void, never>(), buildScope),
    );
    stack.defer(this.#reads.on("changed", () => this.#invalidate()));
    stack.defer(
      this.#libraryScope.on("changed", (scope) => this.#onScopeChanged(scope)),
    );

    this.commit(stack.move());

    await Promise.all([this.#reads.ready, this.#libraryScope.ready]);
    const scope = this.#libraryScope.current;
    this.#scopeKey = scope && availableKey(scope.available);
    logger.info("Item lookup ready", { scopeKey: this.#scopeKey });

    void this.#loadIfNeeded().catch((error) => {
      logger.error("Initial item index load failed", {
        error,
        scopeKey: this.#scopeKey,
      });
    });
    return { builds };
  }

  /**
   * A scope change makes the cached index wrong, not merely stale: interrupt
   * any in-flight build, drop the cache, and build again. A refresh that only
   * renames a group leaves the covered Libraries alone, so it keeps the index
   * and only refreshes the labels drawn from it.
   */
  #onScopeChanged(scope: ResolvedLibraryScope | null): void {
    const scopeKey = scope && availableKey(scope.available);
    if (scopeKey === this.#scopeKey) {
      if (scope) this.#relabel(scope.available);
      return;
    }
    logger.debug("Library scope changed", {
      from: this.#scopeKey,
      to: scopeKey,
    });
    this.#scopeKey = scopeKey;
    this.#cache = null;
    void this.#scheduleRebuild({ restart: true });
  }

  /**
   * Adopt the current names of the Libraries the cached index already covers.
   * Result labels read from {@link ItemCache.libraries}, so a rename that leaves
   * the covered Libraries alone still has to reach them.
   */
  #relabel(libraries: readonly AvailableLibrary[]): void {
    if (this.#cache === null) return;
    if (this.#cache.scopeKey !== availableKey(libraries)) return;
    this.#cache = { ...this.#cache, libraries };
  }

  /** Database refresh: keep serving the stale index (SWR) and rebuild in the
   * background. The in-flight build finishes; a trailing rerun follows it. */
  #invalidate(): void {
    logger.debug("Item index invalidated by database change", {
      scopeKey: this.#scopeKey,
    });
    void this.#scheduleRebuild();
  }

  /** Serve the cached index immediately when present (stale-while-revalidate);
   * only block on a build when there is no valid index for the current scope. */
  async #loadIfNeeded(): Promise<ItemCache | null> {
    if (this.#reads.state === "degraded") {
      this.#cache = null;
      logger.debug("Item index load skipped; database degraded");
      return null;
    }
    const scopeKey = this.#scopeKey;
    if (scopeKey === null) {
      logger.debug("Item index load skipped; library scope unresolved");
      return null;
    }
    if (this.#cache?.scopeKey === scopeKey) {
      logger.debug("Item index cache hit", { scopeKey });
      return this.#cache;
    }
    // Join an in-flight rebuild rather than scheduling another — a read must not
    // inject a trailing rerun into the rebuild lane.
    const joining = this.#rebuildInFlight !== null;
    logger.debug(
      joining
        ? "Item index load joining in-flight rebuild"
        : "Item index load triggering rebuild",
      { scopeKey },
    );
    await (this.#rebuildInFlight ?? this.#scheduleRebuild());
    return this.#cache?.scopeKey === scopeKey ? this.#cache : null;
  }

  /**
   * Single-flight rebuild lane with trailing-rerun coalescing: a refresh
   * arriving mid-rebuild sets a trailing rerun rather than aborting, so a burst
   * of `"changed"` events collapses into one extra rebuild and the index
   * converges instead of starving. `restart` (a scope change) runs a new lane in
   * the build FiberHandle, which interrupts the running one.
   */
  #scheduleRebuild(options?: { restart?: boolean }): Promise<void> {
    if (this.#rebuildInFlight && !options?.restart) {
      this.#rebuildAgain = true;
      logger.debug("Item index rebuild coalesced; trailing rerun scheduled", {
        scopeKey: this.#scopeKey,
      });
      return this.#rebuildInFlight;
    }
    logger.debug("Item index rebuild lane started", {
      scopeKey: this.#scopeKey,
    });
    // A failed startup leaves no lane to run in; search then finds no index.
    const done = this.ready.then(
      async ({ builds }) => {
        const fiber = Effect.runSync(
          FiberHandle.run(builds, this.#rebuildLoop),
        );
        await Effect.runPromise(Fiber.await(fiber));
      },
      () => undefined,
    );
    this.#rebuildInFlight = done;
    void done.finally(() => {
      if (this.#rebuildInFlight === done) this.#rebuildInFlight = null;
    });
    return done;
  }

  readonly #rebuildLoop: Effect.Effect<void> = Effect.suspend(() => {
    this.#rebuildAgain = false;
    return this.#rebuildOnce;
  }).pipe(
    Effect.repeat({
      while: () => {
        if (!this.#rebuildAgain) return false;
        logger.debug("Item index rebuild trailing rerun triggered", {
          scopeKey: this.#scopeKey,
        });
        return true;
      },
    }),
    Effect.asVoid,
  );

  readonly #rebuildOnce: Effect.Effect<void> = Effect.gen(
    { self: this },
    function* () {
      if (this.#reads.state === "degraded") {
        logger.debug("Item index rebuild skipped; database degraded");
        return;
      }
      const t0 = performance.now();
      // Pin one Snapshot for the scope resolution, the signature reads and the
      // whole item stream: a concurrent refresh cannot swap the connection
      // between slices (a torn index), and the cached signatures describe
      // exactly the index stored with them.
      const reads = yield* this.#reads.snapshot;
      const { available } = this.#libraryScope.resolveLibraries(
        yield* reads.Libraries({}),
      );
      const scopeKey = availableKey(available);
      const signatures = yield* Effect.forEach(available, (library) =>
        reads.IndexSignature({ libraryID: library.libraryID }),
      );
      if (
        this.#cache?.scopeKey === scopeKey &&
        signaturesEqual(this.#cache.signatures, signatures)
      ) {
        // Nothing indexed moved, but a group rename would still have landed in
        // this resolution, and result labels are read from the cache.
        this.#relabel(available);
        logger.debug("Item index up to date; skipping rebuild", { scopeKey });
        return;
      }
      this.#tokenizerOpts = this.#createTokenizerOpts();
      const index = yield* this.#buildCompositeIndex(reads, available);
      this.#cache = { scopeKey, libraries: available, index, signatures };
      logger.info("Item index built", {
        libraries: available.length,
        count: index.items.length,
        durationMs: performance.now() - t0,
      });
    },
  ).pipe(
    Effect.scoped,
    Effect.catchTag(["DbUnavailable", "SnapshotExpired"], (error) =>
      // Keep serving the stale index; the next refresh retries the rebuild.
      Effect.sync(() => {
        logger.debug("Item index rebuild skipped; database unavailable", {
          error,
          scopeKey: this.#scopeKey,
        });
      }),
    ),
    // A background rebuild must not reject the promise search() awaits — log
    // and keep serving the stale index. An interrupt passes through.
    Effect.catch((error) => this.#logRebuildFailure(error)),
    Effect.catchDefect((defect) => this.#logRebuildFailure(defect)),
  );

  #logRebuildFailure(error: unknown): Effect.Effect<void> {
    return Effect.sync(() => {
      logger.error("Item index rebuild failed", {
        error,
        scopeKey: this.#scopeKey,
      });
    });
  }

  /**
   * Build one composite index over every Library in scope from each Library's
   * `IndexItems` stream, all read from the caller's Snapshot. An interrupt
   * (a scope change) stops the stream at its next slice.
   */
  #buildCompositeIndex(
    reads: ZoteroReadsApi,
    libraries: readonly AvailableLibrary[],
  ) {
    const builder = createIndexBuilder(this.#tokenizerOpts, {
      libraries: libraries.map((library) => library.libraryID),
      languageLookup: this.#languageLookup,
    });
    return Effect.forEach(
      libraries,
      (library) => {
        logger.debug("Item index build started for a library", {
          libraryID: library.libraryID,
        });
        return Stream.runForEach(
          reads.IndexItems({ libraryID: library.libraryID }),
          (slice) => Effect.sync(() => builder.add(slice)),
        );
      },
      { discard: true },
    ).pipe(Effect.map(() => builder.build()));
  }

  #createTokenizerOpts(): TokenizerOptions {
    return {
      intl: this.#intl,
      chsSegmenter: this.#getChsSegmenter(),
    };
  }

  async #hydrateHits(
    cache: ItemCache,
    leanHits: readonly EngineSearchHit<IndexedItem>[],
  ): Promise<SearchHit[]> {
    if (leanHits.length === 0) return [];

    let hydrated: ReadonlyMap<string, Item>;
    try {
      const { reads } = await this.#reads.ready;
      hydrated = await Effect.runPromise(
        reads.ItemsByIndexedKeys({
          indexedKeys: leanHits.map((hit) => hit.item.indexedKey),
        }),
      );
    } catch (error) {
      if (error instanceof DbUnavailable) {
        logger.debug(
          "Search hydration skipped because the database is unavailable",
          { error, scopeKey: cache.scopeKey },
        );
        return [];
      }
      throw error;
    }

    if (cache.scopeKey !== this.#scopeKey) {
      logger.debug("Search hydration discarded; scope changed", {
        scopeKey: cache.scopeKey,
      });
      return [];
    }

    // One available Library makes every label identical, so the rows carry none.
    const labels =
      cache.libraries.length > 1
        ? new Map(
            cache.libraries.map((library) => [library.libraryID, library]),
          )
        : null;

    return leanHits.flatMap((hit) => {
      const item = hydrated.get(hit.item.indexedKey);
      return item
        ? [
            {
              item,
              score: hit.score,
              matches: hit.matches,
              library: labels?.get(item.libraryID) ?? null,
            },
          ]
        : [];
    });
  }
}
