import { getLanguage } from "obsidian";

import {
  createLanguageLookup,
  getIndexedItemsByLibrary,
  getItemsByID,
  type IndexedItem,
  type Item,
} from "@zotlit/db";
import { type NodeDatabaseClient } from "@zotlit/db/client/node";

import { getLogger } from "@/lib/log";
import {
  DatabaseError,
  type DatabaseService,
} from "@/services/database/service";
import { Service } from "@/services/service-base";
import {
  type Settings,
  type SettingsService,
} from "@/services/settings/service";

import {
  buildIndex,
  searchIndex,
  type SearchHit as EngineSearchHit,
  type SearchIndex,
} from "./engine";
import { type ChsSegmenter, type TokenizerOptions } from "./tokenizer";

const logger = getLogger(["item-lookup"]);
export const DEFAULT_LIMIT = 50;
export type SearchHit = EngineSearchHit<Item>;

export interface ItemLookupDeps {
  db: DatabaseService;
  settings: SettingsService;
  getChsSegmenter?: () => ChsSegmenter | null;
  loadItems?: (
    db: NodeDatabaseClient,
    libraryID: number,
  ) => IndexedItem[] | Promise<IndexedItem[]>;
  hydrateItems?: (
    db: NodeDatabaseClient,
    libraryID: number,
    itemIDs: readonly number[],
  ) => Map<number, Item> | Promise<Map<number, Item>>;
}

interface ItemCache {
  libraryID: number;
  index: SearchIndex;
}

export class ItemLookup extends Service<void> {
  readonly #db;
  readonly #settings;
  readonly #languageLookup;
  readonly #getChsSegmenter;
  readonly #loadItems;
  readonly #hydrateItems;

  #cache: ItemCache | null = null;
  #loadInFlight: Promise<void> | null = null;
  #lastLibraryID: number | null = null;
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
    this.#loadItems = deps.loadItems ?? getIndexedItemsByLibrary;
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
    this.#invalidate();
  }

  #invalidate(): void {
    logger.debug("Item index invalidated", { libraryID: this.#lastLibraryID });
    this.#generation += 1;
    this.#cache = null;
    void this.#loadIfNeeded().catch((error) => {
      logger.error("Item index reload failed", {
        error,
        libraryID: this.#lastLibraryID,
      });
    });
  }

  async #loadIfNeeded(): Promise<SearchIndex | null> {
    while (true) {
      if (this.#db.state !== "ready") {
        this.#cache = null;
        return null;
      }
      const libraryID = this.#lastLibraryID;
      if (libraryID === null) return null;
      if (this.#cache?.libraryID === libraryID) return this.#cache.index;

      if (this.#loadInFlight) {
        await this.#loadInFlight;
        continue;
      }

      const load = this.#loadLibrary(libraryID);
      this.#loadInFlight = load;
      try {
        await load;
      } finally {
        if (this.#loadInFlight === load) this.#loadInFlight = null;
      }
      return this.#cache?.libraryID === libraryID ? this.#cache.index : null;
    }
  }

  async #loadLibrary(libraryID: number): Promise<void> {
    const generation = this.#generation;
    const t0 = performance.now();
    try {
      this.#tokenizerOpts = this.#createTokenizerOpts();
      const items = await this.#loadItems(this.#db.client, libraryID);
      if (generation !== this.#generation) {
        logger.debug("Discarding stale item index build", {
          libraryID,
          generation,
        });
        return;
      }
      this.#cache = {
        libraryID,
        index: buildIndex(items, this.#tokenizerOpts, {
          libraryID,
          languageLookup: this.#languageLookup,
        }),
      };
      logger.info("Item index built", {
        libraryID,
        count: items.length,
        durationMs: performance.now() - t0,
      });
    } catch (error) {
      if (generation === this.#generation) this.#cache = null;
      if (error instanceof DatabaseError) {
        logger.debug(
          "Item lookup skipped because the database is unavailable",
          {
            error,
            libraryID,
          },
        );
        return;
      }
      throw error;
    }
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
      hydrated = await this.#hydrateItems(
        this.#db.client,
        libraryID,
        leanHits.map((hit) => hit.item.itemID),
      );
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

    if (generation !== this.#generation) return [];

    return leanHits.flatMap((hit) => {
      const item = hydrated.get(hit.item.itemID);
      return item ? [{ item, score: hit.score, matches: hit.matches }] : [];
    });
  }
}
