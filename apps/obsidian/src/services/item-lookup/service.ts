/**
 * Search-index lifecycle for the Library Scope, kept fresh with a
 * stale-while-revalidate (SWR) rebuild model:
 *
 * - One **composite index** spans every available Library in scope. Per-Library
 *   BM25 scores are not comparable, so they are never merged: the whole corpus
 *   is indexed together and ranked once, globally.
 * - A database refresh (`db.on("changed")`) rebuilds in the background while
 *   {@link ItemLookup.search} keeps serving the cached index — search never
 *   blocks on a rebuild, so frequent Zotero writes don't freeze suggestions.
 * - A change-gate reads a cheap per-Library `(count, checksum)`
 *   {@link IndexSignature} **vector** first and skips the rebuild when nothing
 *   indexed moved in any covered Library.
 * - Rebuilds are single-flight with a trailing rerun ({@link #scheduleRebuild}):
 *   a refresh arriving mid-build lets the build finish, then reruns once, so a
 *   burst of refreshes converges instead of restarting.
 * - Each rebuild pins one DB snapshot ({@link DatabaseService.acquireRead}) for
 *   its scope resolution, its signature reads, and its chunked hydration, so the
 *   cached signatures are atomic with the index they label and a concurrent
 *   refresh cannot tear chunks across snapshots. The build hydrates one Library
 *   at a time in `dateModified`-desc chunks, yielding the main thread between
 *   chunks so a large scope stays responsive; {@link SearchIndexBuilder.build}
 *   then imposes the global order over the whole corpus.
 *
 * A Library Scope change is a hard invalidation: it bumps {@link #generation} to
 * abandon any in-flight build and search hydration bound to the old scope, and
 * drops the cache so the new scope builds from scratch. A group rename leaves
 * the covered Libraries alone, so it refreshes labels without rebuilding.
 *
 * No fixed Library or Item limit applies; the chunked build is what keeps a
 * large scope affordable.
 */
import { chunk } from "@std/collections/chunk";
import { getLanguage } from "obsidian";

import {
  createLanguageLookup,
  getIndexedItemIDsByLibrary,
  getIndexedItemsByID,
  getIndexSignature,
  getItemsByID,
} from "@zotlit/db";
import type { IndexedItem, IndexSignature, Item } from "@zotlit/db";
import type { NodeDatabaseClient } from "@zotlit/db/client/node";
import { createIndexBuilder, searchIndex } from "@zotlit/item-lookup";
import type {
  ChsSegmenter,
  SearchHit as EngineSearchHit,
  SearchIndex,
  TokenizerOptions,
} from "@zotlit/item-lookup";

import { getLogger } from "@/lib/log";
import { yieldToMain } from "@/lib/yield-to-main";
import { DatabaseError } from "@/services/database/service";
import type { DatabaseService } from "@/services/database/service";
import { availableKey } from "@/services/library-scope/scope";
import type {
  AvailableLibrary,
  ResolvedLibraryScope,
} from "@/services/library-scope/scope";
import type { LibraryScopeService } from "@/services/library-scope/service";
import { Service } from "@/services/service-base";

const logger = getLogger(["item-lookup"]);
export const DEFAULT_LIMIT = 50;

export interface SearchHit extends EngineSearchHit<Item> {
  /**
   * The Library this hit came from, for a muted label on the result row, or
   * `null` when one Library is available and the label would say nothing.
   */
  library: AvailableLibrary | null;
}

/** Items hydrated and indexed per yield, keeping each synchronous slice short
 * enough that the main thread can paint between chunks during a rebuild. */
const INDEX_CHUNK_SIZE = 50;

export interface ItemLookupDeps {
  db: DatabaseService;
  libraryScope: LibraryScopeService;
  getChsSegmenter?: () => ChsSegmenter | null;
  loadItemIDs?: (
    db: NodeDatabaseClient,
    libraryID: number,
  ) => number[] | Promise<number[]>;
  loadItems?: (
    db: NodeDatabaseClient,
    itemIDs: readonly number[],
  ) => IndexedItem[] | Promise<IndexedItem[]>;
  loadSignature?: (
    db: NodeDatabaseClient,
    libraryID: number,
  ) => IndexSignature | Promise<IndexSignature>;
  hydrateItems?: (
    db: NodeDatabaseClient,
    itemIDs: readonly number[],
  ) => Item[] | Promise<Item[]>;
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

export class ItemLookup extends Service<void> {
  readonly #db;
  readonly #libraryScope;
  readonly #languageLookup;
  readonly #getChsSegmenter;
  readonly #loadItemIDs;
  readonly #loadItems;
  readonly #loadSignature;
  readonly #hydrateItems;

  #cache: ItemCache | null = null;
  #rebuildInFlight: Promise<void> | null = null;
  #rebuildAgain = false;
  /** Libraries the index should cover, or `null` while the scope is unresolved. */
  #scopeKey: string | null = null;
  /** Bumped only on a scope change — the hard-abort token for an in-flight build
   * and in-flight search hydration whose Libraries are now wrong. Data refreshes
   * do not bump it; they reconcile via the change-gate and a trailing rebuild. */
  #generation = 0;
  readonly #intl = new Intl.Segmenter(undefined, { granularity: "word" });
  #tokenizerOpts: TokenizerOptions;

  ready: Promise<void>;

  constructor(deps: ItemLookupDeps) {
    super();
    this.#db = deps.db;
    this.#libraryScope = deps.libraryScope;
    this.#languageLookup = createLanguageLookup(getLanguage());
    this.#getChsSegmenter = deps.getChsSegmenter ?? (() => null);
    this.#loadItemIDs = deps.loadItemIDs ?? getIndexedItemIDsByLibrary;
    this.#loadItems = deps.loadItems ?? getIndexedItemsByID;
    this.#loadSignature = deps.loadSignature ?? getIndexSignature;
    this.#hydrateItems = deps.hydrateItems ?? getItemsByID;
    this.#tokenizerOpts = this.#createTokenizerOpts();
    this.ready = this.#load();
  }

  async search(query: string, opts?: { limit?: number }): Promise<SearchHit[]> {
    await this.ready;

    const limit = opts?.limit ?? DEFAULT_LIMIT;
    if (limit <= 0) return [];

    const t0 = performance.now();
    const generation = this.#generation;
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
    const hits = await this.#hydrateHits(cache, leanHits, generation);

    logger.debug("Search completed", {
      libraries: cache.libraries.length,
      queryLength: trimmed.length,
      hits: hits.length,
      durationMs: performance.now() - t0,
    });
    return hits;
  }

  async #load(): Promise<void> {
    await using stack = new AsyncDisposableStack();
    stack.defer(this.#db.on("changed", () => this.#invalidate()));
    stack.defer(
      this.#libraryScope.on("changed", (scope) => this.#onScopeChanged(scope)),
    );

    this.commit(stack.move());

    // Library Scope settles the database on its own way to ready, so its
    // resolution is the only startup signal this service waits on.
    await this.#libraryScope.ready;
    const scope = this.#libraryScope.current;
    this.#scopeKey = scope && availableKey(scope.available);
    logger.info("Item lookup ready", { scopeKey: this.#scopeKey });

    void this.#loadIfNeeded().catch((error) => {
      logger.error("Initial item index load failed", {
        error,
        scopeKey: this.#scopeKey,
      });
    });
  }

  /**
   * A scope change makes the cached index wrong, not merely stale: hard-abort
   * any in-flight build/hydration (generation bump) and drop the cache. A
   * refresh that only renames a group leaves the covered Libraries alone, so it
   * keeps the index and only refreshes the labels drawn from it.
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
    this.#generation += 1;
    this.#cache = null;
    void this.#scheduleRebuild();
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
   * background. {@link #generation} is untouched so the in-flight build finishes. */
  #invalidate(): void {
    logger.debug("Item index invalidated by database change", {
      scopeKey: this.#scopeKey,
    });
    void this.#scheduleRebuild();
  }

  /** Serve the cached index immediately when present (stale-while-revalidate);
   * only block on a build when there is no valid index for the current scope. */
  async #loadIfNeeded(): Promise<ItemCache | null> {
    if (this.#db.state !== "ready") {
      this.#cache = null;
      logger.debug("Item index load skipped; database not ready");
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
   * Single-flight rebuild lane with trailing-rerun coalescing, mirroring
   * {@link DatabaseService}'s refresh loop: a refresh arriving mid-rebuild sets a
   * trailing rerun rather than aborting, so a burst of `"changed"` events collapses
   * into one extra rebuild and the index converges instead of starving.
   */
  #scheduleRebuild(): Promise<void> {
    if (this.#rebuildInFlight) {
      this.#rebuildAgain = true;
      logger.debug("Item index rebuild coalesced; trailing rerun scheduled", {
        scopeKey: this.#scopeKey,
      });
      return this.#rebuildInFlight;
    }
    logger.debug("Item index rebuild lane started", {
      scopeKey: this.#scopeKey,
    });
    this.#rebuildInFlight = this.#rebuildLoop().finally(() => {
      this.#rebuildInFlight = null;
    });
    return this.#rebuildInFlight;
  }

  async #rebuildLoop(): Promise<void> {
    do {
      this.#rebuildAgain = false;
      await this.#rebuildOnce();
      if (this.#rebuildAgain) {
        logger.debug("Item index rebuild trailing rerun triggered", {
          scopeKey: this.#scopeKey,
        });
      }
    } while (this.#rebuildAgain);
  }

  async #rebuildOnce(): Promise<void> {
    if (this.#db.state !== "ready") {
      logger.debug("Item index rebuild skipped; database not ready");
      return;
    }
    const generation = this.#generation;
    const t0 = performance.now();
    try {
      // Pin one DB snapshot for the scope resolution, the signature reads and
      // the whole chunked build: a concurrent refresh cannot swap the client
      // between chunks (a torn index), and the cached signatures describe
      // exactly the index stored with them.
      using lease = await this.#db.acquireRead();
      const { client } = lease;
      const { available } = this.#libraryScope.resolveWith(client);
      const scopeKey = availableKey(available);
      const signatures: IndexSignature[] = [];
      for (const library of available) {
        signatures.push(await this.#loadSignature(client, library.libraryID));
      }
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
      const index = await this.#buildCompositeIndex(
        client,
        available,
        generation,
      );
      if (index === null || generation !== this.#generation) {
        logger.debug("Discarding superseded item index build", {
          scopeKey,
          generation,
        });
        return;
      }
      this.#cache = { scopeKey, libraries: available, index, signatures };
      logger.info("Item index built", {
        libraries: available.length,
        count: index.items.length,
        durationMs: performance.now() - t0,
      });
    } catch (error) {
      if (error instanceof DatabaseError) {
        // Keep serving the stale index; the next refresh retries the rebuild.
        logger.debug("Item index rebuild skipped; database unavailable", {
          error,
          scopeKey: this.#scopeKey,
        });
        return;
      }
      // A background rebuild must not reject the promise search() awaits — log and
      // keep serving the stale index, mirroring DatabaseService's refresh loop.
      logger.error("Item index rebuild failed", {
        error,
        scopeKey: this.#scopeKey,
      });
    }
  }

  /**
   * Build one composite index over every Library in scope — per Library, one
   * lightweight id query up front, then per-chunk hydration — yielding the main
   * thread between chunks so a large scope does not freeze the UI. All reads use
   * the caller's pinned `client` so every chunk reflects one DB snapshot. A
   * scope change bumps {@link #generation}; the per-chunk guard then abandons
   * this now-wrong build.
   *
   * @returns the built index, or `null` when a scope change superseded it.
   */
  async #buildCompositeIndex(
    client: NodeDatabaseClient,
    libraries: readonly AvailableLibrary[],
    generation: number,
  ): Promise<SearchIndex | null> {
    const builder = createIndexBuilder(this.#tokenizerOpts, {
      libraries: libraries.map((library) => library.libraryID),
      languageLookup: this.#languageLookup,
    });
    for (const library of libraries) {
      const itemIDs = await this.#loadItemIDs(client, library.libraryID);
      logger.debug("Item index build started for a library", {
        libraryID: library.libraryID,
        itemCount: itemIDs.length,
        chunkSize: INDEX_CHUNK_SIZE,
      });
      for (const ids of chunk(itemIDs, INDEX_CHUNK_SIZE)) {
        if (generation !== this.#generation) {
          logger.debug("Item index build abandoned mid-chunk; scope changed", {
            generation,
          });
          return null;
        }
        builder.add(await this.#loadItems(client, ids));
        await yieldToMain();
      }
    }
    if (generation !== this.#generation) {
      logger.debug("Item index build abandoned post-chunks; scope changed", {
        generation,
      });
      return null;
    }
    return builder.build();
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
    generation: number,
  ): Promise<SearchHit[]> {
    if (leanHits.length === 0) return [];

    let hydrated: Map<number, Item>;
    try {
      const items = await this.#hydrateItems(
        this.#db.client,
        leanHits.map((hit) => hit.item.itemID),
      );
      hydrated = new Map(items.map((item) => [item.itemID, item]));
    } catch (error) {
      if (error instanceof DatabaseError) {
        logger.debug(
          "Search hydration skipped because the database is unavailable",
          { error, scopeKey: cache.scopeKey },
        );
        return [];
      }
      throw error;
    }

    if (generation !== this.#generation) {
      logger.debug("Search hydration discarded; scope changed", {
        scopeKey: cache.scopeKey,
        generation,
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
      const item = hydrated.get(hit.item.itemID);
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
