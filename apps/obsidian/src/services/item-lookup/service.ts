/**
 * Search-index lifecycle for the citation library, kept fresh with a
 * stale-while-revalidate (SWR) rebuild model:
 *
 * - A database refresh (`db.on("changed")`) rebuilds in the background while
 *   {@link ItemLookup.search} keeps serving the cached index — search never
 *   blocks on a rebuild, so frequent Zotero writes don't freeze suggestions.
 * - A change-gate reads a cheap `(count, checksum)` {@link IndexSignature} first
 *   and skips the rebuild when nothing indexed moved, so the common "refresh
 *   fired but no indexed field changed" case costs one aggregate query.
 * - Rebuilds are single-flight with a trailing rerun ({@link #scheduleRebuild}):
 *   a refresh arriving mid-build lets the build finish, then reruns once, so a
 *   burst of refreshes converges instead of restarting.
 * - Each rebuild pins one DB snapshot ({@link DatabaseService.acquireRead}) for
 *   both its signature read and its chunked hydration, so the cached signature is
 *   atomic with the index it labels and a concurrent refresh cannot tear chunks
 *   across snapshots. The build hydrates in `dateModified`-desc chunks
 *   ({@link #buildLibraryIndex}), yielding the main thread between chunks so a
 *   large library stays responsive.
 *
 * A citation-library switch is a hard reset: it bumps {@link #generation} to
 * abandon any in-flight build and search hydration bound to the old library, and
 * drops the cache so the new library builds from scratch.
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
import { Service } from "@/services/service-base";
import type { Settings, SettingsService } from "@/services/settings/service";

const logger = getLogger(["item-lookup"]);
export const DEFAULT_LIMIT = 50;
export type SearchHit = EngineSearchHit<Item>;

/** Items hydrated and indexed per yield, keeping each synchronous slice short
 * enough that the main thread can paint between chunks during a rebuild. */
const INDEX_CHUNK_SIZE = 50;

export interface ItemLookupDeps {
  db: DatabaseService;
  settings: SettingsService;
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
  libraryID: number;
  index: SearchIndex;
  signature: IndexSignature;
}

function signaturesEqual(a: IndexSignature, b: IndexSignature): boolean {
  return a.count === b.count && a.checksum === b.checksum;
}

export class ItemLookup extends Service<void> {
  readonly #db;
  readonly #settings;
  readonly #languageLookup;
  readonly #getChsSegmenter;
  readonly #loadItemIDs;
  readonly #loadItems;
  readonly #loadSignature;
  readonly #hydrateItems;

  #cache: ItemCache | null = null;
  #rebuildInFlight: Promise<void> | null = null;
  #rebuildAgain = false;
  #lastLibraryID: number | null = null;
  /** Bumped only on library switch — the hard-abort token for an in-flight build
   * and in-flight search hydration whose library is now wrong. Data refreshes do
   * not bump it; they reconcile via the change-gate and a trailing rebuild. */
  #generation = 0;
  readonly #intl = new Intl.Segmenter(undefined, { granularity: "word" });
  #tokenizerOpts: TokenizerOptions;

  ready: Promise<void>;

  constructor(deps: ItemLookupDeps) {
    super();
    this.#db = deps.db;
    this.#settings = deps.settings;
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
    const index = await this.#loadIfNeeded();
    if (!index) {
      logger.debug("Search skipped; no index available", {
        queryLength: query.length,
      });
      return [];
    }

    const trimmed = query.trim();
    const leanHits =
      trimmed.length === 0
        ? index.items.slice(0, limit).map((item) => ({
            item,
            score: 0,
            matches: [],
          }))
        : searchIndex(index, trimmed, {
            tokenizer: this.#tokenizerOpts,
            limit,
          });
    const hits = await this.#hydrateHits(index.libraryID, leanHits, generation);

    logger.debug("Search completed", {
      libraryID: index.libraryID,
      queryLength: trimmed.length,
      hits: hits.length,
      durationMs: performance.now() - t0,
    });
    return hits;
  }

  async #load(): Promise<void> {
    const settings = await this.#settings.loaded;
    this.#lastLibraryID = settings["zotero.citation-library"];

    await using stack = new AsyncDisposableStack();
    stack.defer(this.#db.on("changed", () => this.#invalidate()));
    stack.defer(
      this.#settings.subscribe((next) => {
        if (next === null) return;
        this.#onSettingsChanged(next);
      }),
    );

    this.commit(stack.move());
    logger.info("Item lookup ready", { libraryID: this.#lastLibraryID });

    await this.#db.ready;

    void this.#loadIfNeeded().catch((error) => {
      logger.error("Initial item index load failed", {
        error,
        libraryID: this.#lastLibraryID,
      });
    });
  }

  #onSettingsChanged(settings: Readonly<Settings>): void {
    const libraryID = settings["zotero.citation-library"];
    if (libraryID === this.#lastLibraryID) return;
    logger.debug("Citation library changed", {
      from: this.#lastLibraryID,
      to: libraryID,
    });
    this.#lastLibraryID = libraryID;
    // A switched library makes the cached index wrong, not merely stale: hard-abort
    // any in-flight build/hydration (generation bump) and drop the cache.
    this.#generation += 1;
    this.#cache = null;
    void this.#scheduleRebuild();
  }

  /** Database refresh: keep serving the stale index (SWR) and rebuild in the
   * background. {@link #generation} is untouched so the in-flight build finishes. */
  #invalidate(): void {
    logger.debug("Item index invalidated by database change", {
      libraryID: this.#lastLibraryID,
    });
    void this.#scheduleRebuild();
  }

  /** Serve the cached index immediately when present (stale-while-revalidate);
   * only block on a build when there is no valid index for the current library. */
  async #loadIfNeeded(): Promise<SearchIndex | null> {
    if (this.#db.state !== "ready") {
      this.#cache = null;
      logger.debug("Item index load skipped; database not ready");
      return null;
    }
    const libraryID = this.#lastLibraryID;
    if (libraryID === null) {
      logger.debug("Item index load skipped; no library configured");
      return null;
    }
    if (this.#cache?.libraryID === libraryID) {
      logger.debug("Item index cache hit", { libraryID });
      return this.#cache.index;
    }
    // Join an in-flight rebuild rather than scheduling another — a read must not
    // inject a trailing rerun into the rebuild lane.
    const joining = this.#rebuildInFlight !== null;
    logger.debug(
      joining
        ? "Item index load joining in-flight rebuild"
        : "Item index load triggering rebuild",
      { libraryID },
    );
    await (this.#rebuildInFlight ?? this.#scheduleRebuild());
    return this.#cache?.libraryID === libraryID ? this.#cache.index : null;
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
        libraryID: this.#lastLibraryID,
      });
      return this.#rebuildInFlight;
    }
    logger.debug("Item index rebuild lane started", {
      libraryID: this.#lastLibraryID,
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
          libraryID: this.#lastLibraryID,
        });
      }
    } while (this.#rebuildAgain);
  }

  async #rebuildOnce(): Promise<void> {
    if (this.#db.state !== "ready") {
      logger.debug("Item index rebuild skipped; database not ready");
      return;
    }
    const libraryID = this.#lastLibraryID;
    if (libraryID === null) {
      logger.debug("Item index rebuild skipped; no library configured");
      return;
    }
    const generation = this.#generation;
    const t0 = performance.now();
    try {
      // Pin one DB snapshot for the signature read and the whole chunked build:
      // a concurrent refresh cannot swap the client between chunks (a torn index),
      // and the cached signature describes exactly the index stored with it.
      using lease = await this.#db.acquireRead();
      const { client } = lease;
      const signature = await this.#loadSignature(client, libraryID);
      if (
        this.#cache?.libraryID === libraryID &&
        signaturesEqual(this.#cache.signature, signature)
      ) {
        logger.debug("Item index up to date; skipping rebuild", { libraryID });
        return;
      }
      this.#tokenizerOpts = this.#createTokenizerOpts();
      const index = await this.#buildLibraryIndex(
        client,
        libraryID,
        generation,
      );
      if (index === null || generation !== this.#generation) {
        logger.debug("Discarding superseded item index build", {
          libraryID,
          generation,
        });
        return;
      }
      this.#cache = { libraryID, index, signature };
      logger.info("Item index built", {
        libraryID,
        count: index.items.length,
        durationMs: performance.now() - t0,
      });
    } catch (error) {
      if (error instanceof DatabaseError) {
        // Keep serving the stale index; the next refresh retries the rebuild.
        logger.debug("Item index rebuild skipped; database unavailable", {
          error,
          libraryID,
        });
        return;
      }
      // A background rebuild must not reject the promise search() awaits — log and
      // keep serving the stale index, mirroring DatabaseService's refresh loop.
      logger.error("Item index rebuild failed", { error, libraryID });
    }
  }

  /**
   * Build the library index in dateModified-desc chunks — one lightweight id
   * query up front, then per-chunk hydration — yielding the main thread between
   * chunks so a large library does not freeze the UI. All reads use the caller's
   * pinned `client` so every chunk reflects one DB snapshot. A library switch
   * bumps {@link #generation}; the per-chunk guard then abandons this now-wrong
   * build.
   *
   * @returns the built index, or `null` when a library switch superseded it.
   */
  async #buildLibraryIndex(
    client: NodeDatabaseClient,
    libraryID: number,
    generation: number,
  ): Promise<SearchIndex | null> {
    const itemIDs = await this.#loadItemIDs(client, libraryID);
    logger.debug("Item index build started", {
      libraryID,
      itemCount: itemIDs.length,
      chunkSize: INDEX_CHUNK_SIZE,
    });
    const builder = createIndexBuilder(this.#tokenizerOpts, {
      libraryID,
      languageLookup: this.#languageLookup,
    });
    for (const ids of chunk(itemIDs, INDEX_CHUNK_SIZE)) {
      if (generation !== this.#generation) {
        logger.debug("Item index build abandoned mid-chunk; library switched", {
          libraryID,
          generation,
        });
        return null;
      }
      builder.add(await this.#loadItems(client, ids));
      await yieldToMain();
    }
    if (generation !== this.#generation) {
      logger.debug("Item index build abandoned post-chunks; library switched", {
        libraryID,
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
    libraryID: number,
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
          {
            error,
            libraryID,
          },
        );
        return [];
      }
      throw error;
    }

    if (generation !== this.#generation) {
      logger.debug("Search hydration discarded; library switched", {
        libraryID,
        generation,
      });
      return [];
    }

    return leanHits.flatMap((hit) => {
      const item = hydrated.get(hit.item.itemID);
      return item ? [{ item, score: hit.score, matches: hit.matches }] : [];
    });
  }
}
