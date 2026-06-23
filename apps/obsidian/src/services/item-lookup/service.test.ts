import { describe, expect, it, vi } from "vitest";

import { type IndexedItem, type IndexSignature, type Item } from "@zotlit/db";
import { USER_LIBRARY_ID } from "@zotlit/db";
import { type NodeDatabaseClient } from "@zotlit/db/client/node";
import {
  makeCreator as creator,
  makeIndexedItem as indexedItem,
  makeItem as item,
  type ItemFixtureOptions,
} from "@zotlit/item-lookup/fixtures";

import {
  DatabaseError,
  type DatabaseService,
} from "@/services/database/service";
import { type Settings } from "@/services/settings/schema";
import { type SettingsService } from "@/services/settings/service";

import { ItemLookup } from "./service";

describe("ItemLookup", () => {
  it("prewarms and reuses the cache", async () => {
    const alpha = itemPair({ key: "A", title: "Alpha" });
    const deps = createDeps({
      indexItems: [alpha.indexed],
      hydratedItems: [alpha.full],
    });
    const lookup = new ItemLookup(deps);

    await lookup.ready;
    await waitForCallCount(deps.loadItems, 1);
    expect(await lookup.search("", { limit: 1 })).toHaveLength(1);
    expect(await lookup.search("Alpha", { limit: 1 })).toHaveLength(1);
    expect(deps.loadItems).toHaveBeenCalledOnce();
  });

  it("prewarms only after db.ready resolves", async () => {
    const db = new FakeDb({ ready: "pending" });
    const alpha = itemPair({ key: "A", title: "Alpha" });
    const deps = createDeps({
      db,
      indexItems: [alpha.indexed],
      hydratedItems: [alpha.full],
    });
    const lookup = new ItemLookup(deps);

    await Promise.resolve();
    expect(deps.loadItems).not.toHaveBeenCalled();

    db.resolveReady();
    await lookup.ready;
    await waitForCallCount(deps.loadItems, 1);
  });

  it("deduplicates parallel loads", async () => {
    const alpha = itemPair({ key: "A", title: "Alpha" });
    let resolveLoad: (items: IndexedItem[]) => void = () => undefined;
    const deps = createDeps({
      indexItems: [alpha.indexed],
      hydratedItems: [alpha.full],
      loadItems: vi.fn(
        () =>
          new Promise<IndexedItem[]>((resolve) => {
            resolveLoad = resolve;
          }),
      ),
    });
    const lookup = new ItemLookup(deps);
    await lookup.ready;

    const first = lookup.search("", { limit: 1 });
    const second = lookup.search("Alpha", { limit: 1 });
    await waitForCallCount(deps.loadItems, 1);

    expect(deps.loadItems).toHaveBeenCalledOnce();
    resolveLoad([alpha.indexed]);
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
  });

  it("rebuilds on a database change when the signature moves", async () => {
    const db = new FakeDb();
    const alpha = itemPair({ key: "A", title: "Alpha" });
    let count = 1;
    const deps = createDeps({
      db,
      indexItems: [alpha.indexed],
      hydratedItems: [alpha.full],
      loadSignature: vi.fn(() => ({ count, checksum: 0 })),
    });
    const lookup = new ItemLookup(deps);

    await lookup.search("");
    await waitForCallCount(deps.loadItems, 1);
    count = 2;
    db.emitChanged();
    await waitForCallCount(deps.loadItems, 2);

    expect(deps.loadItems).toHaveBeenCalledTimes(2);
  });

  it("skips the rebuild when a database change leaves the signature unchanged", async () => {
    const db = new FakeDb();
    const alpha = itemPair({ key: "A", title: "Alpha" });
    const deps = createDeps({
      db,
      indexItems: [alpha.indexed],
      hydratedItems: [alpha.full],
      loadSignature: vi.fn(() => ({ count: 1, checksum: 0 })),
    });
    const lookup = new ItemLookup(deps);

    await lookup.search("");
    await waitForCallCount(deps.loadItems, 1);
    db.emitChanged();
    // The gate runs but finds nothing changed, so no second hydration occurs.
    await waitForCallCount(deps.loadItems, 2);
    expect(deps.loadItems).toHaveBeenCalledOnce();
  });

  it("invalidates when the citation library changes", async () => {
    const settings = new FakeSettings();
    const libraryKey = (libraryID: number): string =>
      libraryID === USER_LIBRARY_ID ? "A" : "B";
    const itemLibrary = (itemID: number): number =>
      itemID === "B".charCodeAt(0) ? 2 : USER_LIBRARY_ID;
    const deps = createDeps({
      settings,
      loadItemIDs: vi.fn((_client, libraryID) => [
        libraryKey(libraryID).charCodeAt(0),
      ]),
      loadItems: vi.fn((_client, itemIDs) => {
        const libraryID = itemLibrary(itemIDs[0]!);
        return [indexedItem({ key: libraryKey(libraryID), libraryID })];
      }),
      hydrateItems: vi.fn((_client, itemIDs) => {
        const libraryID = itemLibrary(itemIDs[0]!);
        return [item({ key: libraryKey(libraryID), libraryID })];
      }),
    });
    const lookup = new ItemLookup(deps);

    expect((await lookup.search(""))[0]?.item.libraryID).toBe(USER_LIBRARY_ID);
    settings.setLibrary(2);
    expect((await lookup.search(""))[0]?.item.libraryID).toBe(2);
    expect(deps.loadItems).toHaveBeenCalledTimes(2);
  });

  it("returns an empty list while the database is degraded", async () => {
    const db = new FakeDb();
    db.error = new DatabaseError("degraded");
    const deps = createDeps({ db });
    const lookup = new ItemLookup(deps);

    await expect(lookup.search("anything")).resolves.toEqual([]);
    expect(deps.loadItems).not.toHaveBeenCalled();
  });

  it("does not serve cached items after the database degrades", async () => {
    const db = new FakeDb();
    const alpha = itemPair({ key: "A", title: "Alpha" });
    const deps = createDeps({
      db,
      indexItems: [alpha.indexed],
      hydratedItems: [alpha.full],
    });
    const lookup = new ItemLookup(deps);

    await expect(lookup.search("")).resolves.toHaveLength(1);
    db.error = new DatabaseError("degraded");

    await expect(lookup.search("")).resolves.toEqual([]);
    expect(deps.loadItems).toHaveBeenCalledOnce();
  });

  it("degrades to empty when a background rebuild throws a non-database error", async () => {
    const db = new FakeDb();
    const deps = createDeps({
      db,
      loadItemIDs: vi.fn(() => [1]),
      loadItems: vi.fn(() => {
        throw new TypeError("malformed row");
      }),
    });
    const lookup = new ItemLookup(deps);

    await expect(lookup.search("anything")).resolves.toEqual([]);
  });

  it("returns recent items for an empty query", async () => {
    const alpha = itemPair({ key: "A", title: "Alpha" });
    const beta = itemPair({ key: "B", title: "Beta" });
    const lookup = new ItemLookup(
      createDeps({
        indexItems: [alpha.indexed, beta.indexed],
        hydratedItems: [alpha.full, beta.full],
      }),
    );

    await expect(lookup.search(" ", { limit: 1 })).resolves.toEqual([
      { item: alpha.full, score: 0, matches: [] },
    ]);
  });

  it("searches across title, creators, and date", async () => {
    const alpha = itemPair({
      key: "A",
      title: "Senior citizen transit ID cards",
      creators: [creator("Transit", "SEPTA")],
      date: "2015-01-01",
    });
    const beta = itemPair({
      key: "B",
      title: "Senior services overview",
      creators: [creator("Jane", "Doe")],
      date: "2015-01-01",
    });
    const lookup = new ItemLookup(
      createDeps({
        indexItems: [alpha.indexed, beta.indexed],
        hydratedItems: [alpha.full, beta.full],
      }),
    );

    const hits = await lookup.search("senior septa 2015", { limit: 3 });

    expect(hits.map((hit) => hit.item.key)).toEqual(["A"]);
  });

  it("lets an in-flight build finish and serves it stale while rebuilding", async () => {
    const db = new FakeDb();
    const stale = itemPair({ key: "A", title: "Stale" });
    const fresh = itemPair({ key: "B", title: "Fresh" });
    const loadResolvers: ((items: IndexedItem[]) => void)[] = [];
    let count = 1;
    const deps = createDeps({
      db,
      hydratedItems: [stale.full, fresh.full],
      loadItemIDs: vi.fn(() => [1]),
      loadItems: vi.fn(
        () =>
          new Promise<IndexedItem[]>((resolve) => {
            loadResolvers.push(resolve);
          }),
      ),
      loadSignature: vi.fn(() => ({ count, checksum: 0 })),
    });
    const lookup = new ItemLookup(deps);
    await lookup.ready;

    await waitForCallCount(deps.loadItems, 1);
    // A change arrives mid-build; the signature moves so a rebuild is owed.
    count = 2;
    db.emitChanged();
    // The first build is not aborted — finishing it populates the stale cache.
    loadResolvers[0]!([stale.indexed]);
    await waitForCallCount(deps.loadItems, 2);

    // SWR: the trailing rebuild is in flight, yet search returns the stale index.
    await expect(lookup.search("", { limit: 1 })).resolves.toMatchObject([
      { item: { key: "A" } },
    ]);

    loadResolvers[1]!([fresh.indexed]);
    await settle();
    await expect(lookup.search("", { limit: 1 })).resolves.toMatchObject([
      { item: { key: "B" } },
    ]);
  });

  it("drops search results when the library switches mid-hydration", async () => {
    const db = new FakeDb();
    const settings = new FakeSettings();
    const alpha = itemPair({ key: "A", title: "Alpha" });
    let resolveHydration: (items: Item[]) => void = () => undefined;
    const deps = createDeps({
      db,
      settings,
      indexItems: [alpha.indexed],
      hydratedItems: [alpha.full],
      hydrateItems: vi.fn(
        () =>
          new Promise<Item[]>((resolve) => {
            resolveHydration = resolve;
          }),
      ),
    });
    const lookup = new ItemLookup(deps);
    await lookup.ready;
    await waitForCallCount(deps.loadItems, 1);

    const search = lookup.search("Alpha");
    await waitForCallCount(deps.hydrateItems, 1);
    settings.setLibrary(2);
    resolveHydration([alpha.full]);

    await expect(search).resolves.toEqual([]);
  });

  it("drops hits that fail hydration", async () => {
    const alpha = itemPair({ key: "A", title: "Alpha" });
    const lookup = new ItemLookup(
      createDeps({
        indexItems: [alpha.indexed],
        hydrateItems: vi.fn(() => []),
      }),
    );

    await expect(lookup.search("Alpha")).resolves.toEqual([]);
  });
});

async function waitForCallCount(
  fn: ReturnType<typeof vi.fn>,
  count: number,
): Promise<void> {
  // The chunked build yields a macrotask between chunks, so flush both micro-
  // and macrotasks while waiting for an intermediate call count.
  for (let i = 0; i < 50; i++) {
    if (fn.mock.calls.length === count) return;
    await new Promise((resolve) => setTimeout(resolve));
  }
}

/** Flush a handful of macrotasks so a background rebuild's chunk yields and final
 * cache swap settle before asserting. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve));
  }
}

function createDeps(
  options: {
    db?: FakeDb;
    settings?: FakeSettings;
    indexItems?: IndexedItem[];
    hydratedItems?: Item[];
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
  } = {},
) {
  const indexItems = options.indexItems ?? [];
  const hydratedItems = options.hydratedItems ?? [];
  return {
    db: (options.db ?? new FakeDb()) as unknown as DatabaseService,
    settings: (options.settings ??
      new FakeSettings()) as unknown as SettingsService,
    loadItemIDs: vi.fn(
      options.loadItemIDs ?? (() => indexItems.map((item) => item.itemID)),
    ),
    loadItems: vi.fn(
      options.loadItems ??
        ((_db, itemIDs) =>
          indexItems.filter((item) => itemIDs.includes(item.itemID))),
    ),
    loadSignature: vi.fn(
      options.loadSignature ??
        (() => ({ count: indexItems.length, checksum: 0 })),
    ),
    hydrateItems: vi.fn(
      options.hydrateItems ??
        ((_db, itemIDs) =>
          hydratedItems.filter((candidate) =>
            itemIDs.includes(candidate.itemID),
          )),
    ),
  };
}

class FakeDb {
  error: DatabaseError | null = null;
  readonly #client = {} as NodeDatabaseClient;
  readonly #changed = new Set<() => void>();
  #resolveReady: () => void = () => undefined;
  readonly #ready: Promise<void>;

  constructor(options: { ready?: "resolved" | "pending" } = {}) {
    this.#ready =
      options.ready === "pending"
        ? new Promise((resolve) => {
            this.#resolveReady = resolve;
          })
        : Promise.resolve();
  }

  get state(): "ready" | "degraded" {
    return this.error ? "degraded" : "ready";
  }

  get ready(): Promise<void> {
    return this.#ready;
  }

  get client(): NodeDatabaseClient {
    if (this.error) throw this.error;
    return this.#client;
  }

  acquireRead(): { client: NodeDatabaseClient } & Disposable {
    if (this.error) throw this.error;
    return { client: this.#client, [Symbol.dispose]: () => undefined };
  }

  on(event: "changed", cb: () => void): () => void {
    this.#changed.add(cb);
    return () => {
      this.#changed.delete(cb);
    };
  }

  emitChanged(): void {
    for (const cb of this.#changed) cb();
  }

  resolveReady(): void {
    this.#resolveReady();
  }
}

class FakeSettings {
  #value = {
    "zotero.citation-library": USER_LIBRARY_ID,
    "citation.editor-suggester": true,
    "citation.show-citekey-in-suggester": false,
  } as Settings;

  readonly #subscribers = new Set<(value: Readonly<Settings> | null) => void>();

  get current(): Readonly<Settings> {
    return this.#value;
  }

  get loaded(): Promise<Readonly<Settings>> {
    return Promise.resolve(this.#value);
  }

  subscribe(cb: (value: Readonly<Settings> | null) => void): () => void {
    this.#subscribers.add(cb);
    cb(this.#value);
    return () => {
      this.#subscribers.delete(cb);
    };
  }

  setLibrary(libraryID: number): void {
    this.#value = {
      ...this.#value,
      "zotero.citation-library": libraryID,
    };
    for (const cb of this.#subscribers) cb(this.#value);
  }
}

function itemPair(options: ItemFixtureOptions): {
  indexed: IndexedItem;
  full: Item;
} {
  return {
    indexed: indexedItem(options),
    full: item(options),
  };
}
