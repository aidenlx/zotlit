import { describe, expect, it, vi } from "vitest";
import type { DatabaseClient, Item } from "@zotlit/db";

import {
  DatabaseError,
  type DatabaseService,
} from "@/services/database/service";
import type { Settings } from "@/services/settings/schema";
import type { SettingsService } from "@/services/settings/service";
import { makeCreator as creator, makeItem as item } from "./fixtures";
import { ItemLookup } from "./service";

describe("ItemLookup", () => {
  it("prewarms and reuses the cache", async () => {
    const items = [item({ key: "A", title: "Alpha" })];
    const deps = createDeps({
      loadItems: vi.fn(() => items),
    });
    const lookup = new ItemLookup(deps);

    await lookup.ready;
    await waitForCallCount(deps.loadItems, 1);
    expect(await lookup.search("", { limit: 1 })).toHaveLength(1);
    expect(await lookup.search("Alpha", { limit: 1 })).toHaveLength(1);
    expect(deps.loadItems).toHaveBeenCalledOnce();
  });

  it("deduplicates parallel loads", async () => {
    let resolveLoad: (items: Item[]) => void = () => undefined;
    const deps = createDeps({
      loadItems: vi.fn(
        () =>
          new Promise<Item[]>((resolve) => {
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
    resolveLoad([item({ key: "A", title: "Alpha" })]);
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
  });

  it("invalidates on database changes", async () => {
    const db = new FakeDb();
    const deps = createDeps({
      db,
      loadItems: vi.fn(() => [item({ key: "A", title: "Alpha" })]),
    });
    const lookup = new ItemLookup(deps);

    await lookup.search("");
    db.emitChanged();
    await waitForCallCount(deps.loadItems, 2);
    await lookup.search("");

    expect(deps.loadItems).toHaveBeenCalledTimes(2);
  });

  it("invalidates when the citation library changes", async () => {
    const settings = new FakeSettings();
    const deps = createDeps({
      settings,
      loadItems: vi.fn((_client, libraryID) => [
        item({ key: `L${libraryID}`, libraryID }),
      ]),
    });
    const lookup = new ItemLookup(deps);

    expect((await lookup.search(""))[0]?.item.libraryID).toBe(1);
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
    const deps = createDeps({
      db,
      loadItems: vi.fn(() => [item({ key: "A", title: "Alpha" })]),
    });
    const lookup = new ItemLookup(deps);

    await expect(lookup.search("")).resolves.toHaveLength(1);
    db.error = new DatabaseError("degraded");

    await expect(lookup.search("")).resolves.toEqual([]);
    expect(deps.loadItems).toHaveBeenCalledOnce();
  });

  it("returns recent items for an empty query", async () => {
    const items = [
      item({ key: "A", title: "Alpha" }),
      item({ key: "B", title: "Beta" }),
    ];
    const lookup = new ItemLookup(
      createDeps({ loadItems: vi.fn(() => items) }),
    );

    await expect(lookup.search(" ", { limit: 1 })).resolves.toEqual([
      { item: items[0], score: 0, matches: [] },
    ]);
  });

  it("searches across title, creators, and date", async () => {
    const items = [
      item({
        key: "A",
        title: "Senior citizen transit ID cards",
        creators: [creator("Transit", "SEPTA")],
        date: "2015-01-01",
      }),
      item({
        key: "B",
        title: "Senior services overview",
        creators: [creator("Jane", "Doe")],
        date: "2015-01-01",
      }),
    ];
    const lookup = new ItemLookup(
      createDeps({ loadItems: vi.fn(() => items) }),
    );

    const hits = await lookup.search("senior septa 2015", { limit: 3 });

    expect(hits.map((hit) => hit.item.key)).toEqual(["A"]);
  });
});

async function waitForCallCount(
  fn: ReturnType<typeof vi.fn>,
  count: number,
): Promise<void> {
  for (let i = 0; i < 5; i++) {
    if (fn.mock.calls.length === count) return;
    await Promise.resolve();
  }
}

function createDeps(
  options: {
    db?: FakeDb;
    settings?: FakeSettings;
    loadItems?: (
      db: DatabaseClient,
      libraryID: number,
    ) => Item[] | Promise<Item[]>;
  } = {},
) {
  return {
    db: (options.db ?? new FakeDb()) as unknown as DatabaseService,
    settings: (options.settings ??
      new FakeSettings()) as unknown as SettingsService,
    loadItems: vi.fn(options.loadItems ?? (() => [])),
  };
}

class FakeDb {
  error: DatabaseError | null = null;
  readonly #client = {} as DatabaseClient;
  readonly #changed = new Set<() => void>();

  get state(): "ready" | "degraded" {
    return this.error ? "degraded" : "ready";
  }

  get client(): DatabaseClient {
    if (this.error) throw this.error;
    return this.#client;
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
}

class FakeSettings {
  #value = {
    "zotero.citation-library": 1,
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
