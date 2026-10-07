import { Effect, Exit, Queue, Stream } from "effect";
import { describe, expect, it } from "vitest";

import { USER_LIBRARY_ID } from "@zotlit/db";
import type { IndexedItem, Item, Library } from "@zotlit/db";

import type {
  AvailableLibrary,
  ResolvedLibraryScope,
} from "@/services/library-scope/scope";
import type { LibraryScopeService } from "@/services/library-scope/service";
import type { ZoteroReadsClient } from "@/services/zotero-reads/in-process";
import { DbUnavailable } from "@/services/zotero-reads/rpc";
import type { ChangeEvent } from "@/services/zotero-reads/rpc";
import {
  inProcessReadsService,
  memoryOpener,
} from "@/services/zotero-reads/test-utils";

import { ItemLookup } from "./service";

describe("ItemLookup", () => {
  it("prewarms and reuses the cache", async () => {
    await using reads = readsOver(() => seed([row({ key: "AAAAAAAA" })]));
    await using lookup = itemLookup(reads);

    await lookup.ready;
    await expect.poll(() => reads.indexed).toEqual([USER_LIBRARY_ID]);
    expect(await lookup.search("", { limit: 1 })).toHaveLength(1);
    expect(await lookup.search("Alpha", { limit: 1 })).toHaveLength(1);
    expect(reads.indexed).toEqual([USER_LIBRARY_ID]);
  });

  it("prewarms only after the reads service is ready", async () => {
    const opening = Promise.withResolvers<void>();
    await using reads = readsOver(() => seed([row({ key: "AAAAAAAA" })]), {
      opening: opening.promise,
    });
    await using lookup = itemLookup(reads);

    await delayTicks();
    expect(reads.indexed).toEqual([]);

    opening.resolve();
    await lookup.ready;
    await expect.poll(() => reads.indexed).toEqual([USER_LIBRARY_ID]);
  });

  it("deduplicates parallel loads", async () => {
    await using reads = readsOver(() => seed([row({ key: "AAAAAAAA" })]));
    const gate = reads.gateIndexItems();
    await using lookup = itemLookup(reads);
    await lookup.ready;

    const first = lookup.search("", { limit: 1 });
    const second = lookup.search("Alpha", { limit: 1 });
    await expect.poll(() => reads.indexed).toHaveLength(1);

    gate.resolve();
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(reads.indexed).toEqual([USER_LIBRARY_ID]);
  });

  it("rebuilds on a database change when the signature moves", async () => {
    await using reads = readsOver((open) =>
      seed([
        row({ key: "AAAAAAAA" }),
        ...(open > 1 ? [row({ key: "BBBBBBBB", title: "Beta" })] : []),
      ]),
    );
    await using lookup = itemLookup(reads);

    expect(await lookup.search("")).toHaveLength(1);
    await reads.service.refresh();

    await expect.poll(() => reads.indexed).toHaveLength(2);
    await expect.poll(() => lookup.search("")).toHaveLength(2);
  });

  it("skips the rebuild when a database change leaves the signature unchanged", async () => {
    await using reads = readsOver(() => seed([row({ key: "AAAAAAAA" })]));
    await using lookup = itemLookup(reads);

    await lookup.search("");
    const signatures = reads.signatures;
    await reads.service.refresh();

    await expect.poll(() => reads.signatures).toBeGreaterThan(signatures);
    await delayTicks();
    expect(reads.indexed).toEqual([USER_LIBRARY_ID]);
  });

  it("hard-invalidates when the library scope changes", async () => {
    await using reads = readsOver(() => seed(perLibraryRows()));
    const libraryScope = new FakeLibraryScope();
    await using lookup = itemLookup(reads, libraryScope);

    expect((await lookup.search(""))[0]?.item.libraryID).toBe(USER_LIBRARY_ID);
    libraryScope.setLibraries([library(2)]);
    expect((await lookup.search(""))[0]?.item.libraryID).toBe(2);
    expect(reads.indexed).toEqual([USER_LIBRARY_ID, 2]);
  });

  it("abandons a build when the library scope changes mid-build", async () => {
    await using reads = readsOver(() => seed(perLibraryRows()));
    const libraryScope = new FakeLibraryScope();
    const gate = reads.gateIndexItems();
    await using lookup = itemLookup(reads, libraryScope);
    await lookup.ready;
    await expect.poll(() => reads.indexed).toEqual([USER_LIBRARY_ID]);

    gate.release();
    libraryScope.setLibraries([library(2)]);

    await expect.poll(() => reads.interrupted).toEqual([USER_LIBRARY_ID]);
    gate.resolve();
    const hits = await lookup.search("");
    expect(hits.map((hit) => hit.item.libraryID)).toEqual([2]);
  });

  it("refreshes labels without rebuilding when a refresh only renames a group", async () => {
    await using reads = readsOver(() => seed(perLibraryRows()));
    const libraryScope = new FakeLibraryScope([
      library(USER_LIBRARY_ID),
      library(2),
    ]);
    await using lookup = itemLookup(reads, libraryScope);

    await lookup.search("");
    const builds = reads.indexed.length;
    libraryScope.setLibraries([
      library(USER_LIBRARY_ID),
      { ...library(2), name: "Renamed" },
    ]);
    const hits = await lookup.search("");

    expect(hits.map((hit) => hit.library?.name)).toEqual([null, "Renamed"]);
    expect(reads.indexed).toHaveLength(builds);
  });

  it("indexes every library in scope in canonical order", async () => {
    await using reads = readsOver(() => seed(perLibraryRows()));
    const libraryScope = new FakeLibraryScope([
      library(USER_LIBRARY_ID),
      library(2),
    ]);
    await using lookup = itemLookup(reads, libraryScope);

    const hits = await lookup.search("");

    expect(hits.map((hit) => hit.item.libraryID)).toEqual([USER_LIBRARY_ID, 2]);
    expect(reads.indexed).toEqual([USER_LIBRARY_ID, 2]);
  });

  it("labels results only when several libraries can contribute", async () => {
    await using reads = readsOver(() => seed(perLibraryRows()));
    const libraryScope = new FakeLibraryScope();
    await using lookup = itemLookup(reads, libraryScope);

    expect((await lookup.search("")).map((hit) => hit.library)).toEqual([null]);

    libraryScope.setLibraries([library(USER_LIBRARY_ID), library(2)]);

    expect(
      (await lookup.search("")).map((hit) => hit.library?.libraryID),
    ).toEqual([USER_LIBRARY_ID, 2]);
  });

  it("rebuilds when any covered library's signature moves", async () => {
    await using reads = readsOver((open) =>
      seed([
        ...perLibraryRows(),
        ...(open > 1
          ? [row({ key: "GGGGGGGG", itemID: 201, libraryID: 2 })]
          : []),
      ]),
    );
    const libraryScope = new FakeLibraryScope([
      library(USER_LIBRARY_ID),
      library(2),
    ]);
    await using lookup = itemLookup(reads, libraryScope);

    await lookup.search("");
    const builds = reads.indexed.length;
    await reads.service.refresh();

    await expect.poll(() => reads.indexed).toHaveLength(builds * 2);
    await expect.poll(() => lookup.search("")).toHaveLength(3);
  });

  it("serves an empty result for a scope with no available library", async () => {
    await using reads = readsOver(() => seed(perLibraryRows()));
    await using lookup = itemLookup(reads, new FakeLibraryScope([]));

    await expect(lookup.search("")).resolves.toEqual([]);
    expect(reads.indexed).toEqual([]);
  });

  it("returns an empty list while the database is degraded", async () => {
    await using reads = readsOver(() => null);
    await using lookup = itemLookup(reads);

    await expect(lookup.search("anything")).resolves.toEqual([]);
    expect(reads.indexed).toEqual([]);
  });

  it("does not serve cached items after the database degrades", async () => {
    await using reads = readsOver(() => seed([row({ key: "AAAAAAAA" })]));
    await using lookup = itemLookup(reads);

    await expect(lookup.search("")).resolves.toHaveLength(1);
    reads.emit({
      _tag: "degraded",
      error: new DbUnavailable({ message: "worker lost" }),
    });
    await expect.poll(() => reads.service.state).toBe("degraded");

    await expect(lookup.search("")).resolves.toEqual([]);
    expect(reads.indexed).toEqual([USER_LIBRARY_ID]);
  });

  it("degrades to empty when a background rebuild throws a non-database error", async () => {
    await using reads = readsOver(() => seed([row({ key: "AAAAAAAA" })]), {
      indexItems: () => Stream.die(new TypeError("malformed row")),
    });
    await using lookup = itemLookup(reads);

    await expect(lookup.search("anything")).resolves.toEqual([]);
  });

  it("returns recent items for an empty query", async () => {
    await using reads = readsOver(() =>
      seed([
        row({ key: "AAAAAAAA", modified: "2024-01-02 00:00:00" }),
        row({ key: "BBBBBBBB", itemID: 2, title: "Beta" }),
      ]),
    );
    await using lookup = itemLookup(reads);

    await expect(lookup.search(" ", { limit: 1 })).resolves.toMatchObject([
      {
        item: { key: "AAAAAAAA", fields: { title: "Alpha" } },
        score: 0,
        matches: [],
        library: null,
      },
    ]);
  });

  it("searches across title, creators, and date", async () => {
    await using reads = readsOver(() =>
      seed([
        row({
          key: "AAAAAAAA",
          title: "Senior citizen transit ID cards",
          creator: ["Transit", "SEPTA"],
          date: "2015-01-01",
        }),
        row({
          key: "BBBBBBBB",
          itemID: 2,
          title: "Senior services overview",
          creator: ["Jane", "Doe"],
          date: "2015-01-01",
        }),
      ]),
    );
    await using lookup = itemLookup(reads);

    const hits = await lookup.search("senior septa 2015", { limit: 3 });

    expect(hits.map((hit) => hit.item.key)).toEqual(["AAAAAAAA"]);
  });

  it("lets an in-flight build finish and serves it stale while rebuilding", async () => {
    await using reads = readsOver((open) =>
      seed([
        row({ key: "AAAAAAAA", title: "Stale" }),
        ...(open > 1
          ? [
              row({
                key: "BBBBBBBB",
                itemID: 2,
                title: "Fresh",
                modified: "2024-01-02 00:00:00",
              }),
            ]
          : []),
      ]),
    );
    const first = reads.gateIndexItems();
    await using lookup = itemLookup(reads);
    await lookup.ready;
    await expect.poll(() => reads.indexed).toHaveLength(1);

    // A change arrives mid-build; the signature moves so a rebuild is owed.
    const second = reads.gateIndexItems();
    await reads.service.refresh();
    // The first build is not aborted — finishing it populates the stale cache.
    first.resolve();
    await expect.poll(() => reads.indexed).toHaveLength(2);

    // SWR: the trailing rebuild is in flight, yet search returns the stale index.
    await expect(lookup.search("", { limit: 1 })).resolves.toMatchObject([
      { item: { key: "AAAAAAAA" } },
    ]);

    second.resolve();
    await expect
      .poll(() => lookup.search("", { limit: 1 }))
      .toMatchObject([{ item: { key: "BBBBBBBB" } }]);
  });

  it("drops search results when the scope changes mid-hydration", async () => {
    await using reads = readsOver(() => seed(perLibraryRows()));
    const libraryScope = new FakeLibraryScope();
    await using lookup = itemLookup(reads, libraryScope);
    await lookup.search("");
    const hydration = reads.gateHydration();

    const search = lookup.search("");
    await expect.poll(() => reads.hydrations).toBe(2);
    libraryScope.setLibraries([library(2)]);
    hydration.resolve();

    await expect(search).resolves.toEqual([]);
  });

  it("drops hits that fail hydration", async () => {
    await using reads = readsOver(() => seed([row({ key: "AAAAAAAA" })]), {
      hydrate: () => Effect.succeed(new Map()),
    });
    await using lookup = itemLookup(reads);

    await expect(lookup.search("Alpha")).resolves.toEqual([]);
  });
});

function itemLookup(
  reads: ObservedReads,
  libraryScope: FakeLibraryScope = new FakeLibraryScope(),
): ItemLookup {
  return new ItemLookup({
    reads: reads.service,
    libraryScope: libraryScope as unknown as LibraryScopeService,
  });
}

async function delayTicks(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

interface RowOptions {
  key: string;
  itemID?: number;
  libraryID?: number;
  title?: string;
  date?: string;
  creator?: [firstName: string, lastName: string];
  /** `dateModified` in Zotero's format. */
  modified?: string;
}

const row = (options: RowOptions) => options;

/** One item per Library; the item id derives from the Library id. */
function perLibraryRows(): RowOptions[] {
  return [USER_LIBRARY_ID, 2].map((libraryID) => ({
    key: `LIBRARY${libraryID + 1}`,
    itemID: libraryID * 100,
    libraryID,
  }));
}

/**
 * SQL for a user library (1) and a group library (2, group 2) holding `rows`
 * as journal articles; a row without a title is titled "Alpha".
 */
function seed(rows: readonly RowOptions[]): string {
  const values = (list: string[]) => list.join(",\n");
  const itemRows = rows.map((r, index) => {
    const itemID = r.itemID ?? index + 1;
    const modified = r.modified ?? "2024-01-01 00:00:00";
    return `(${itemID}, 1, '2024-01-01 00:00:00', '${modified}', ${r.libraryID ?? USER_LIBRARY_ID}, '${r.key}')`;
  });
  const data: string[] = [];
  const dataValues: string[] = [];
  const creators: string[] = [];
  const itemCreators: string[] = [];
  rows.forEach((r, index) => {
    const itemID = r.itemID ?? index + 1;
    const fields: [number, string | undefined][] = [
      [10, r.title ?? "Alpha"],
      [12, r.date],
    ];
    for (const [fieldID, value] of fields) {
      if (value === undefined) continue;
      const valueID = dataValues.length + 1;
      dataValues.push(`(${valueID}, '${value}')`);
      data.push(`(${itemID}, ${fieldID}, ${valueID})`);
    }
    if (r.creator) {
      const creatorID = creators.length + 1;
      creators.push(`(${creatorID}, '${r.creator[0]}', '${r.creator[1]}', 0)`);
      itemCreators.push(`(${itemID}, ${creatorID}, 1, 0)`);
    }
  });
  return `
    insert into libraries (libraryID, type, version, clientVersion)
      values (1, 'user', 1, 0), (2, 'group', 1, 0);
    insert into groups (groupID, libraryID, name) values (2, 2, 'Group 2');
    insert into itemTypes (itemTypeID, typeName) values (1, 'journalArticle');
    insert into fieldsCombined (fieldID, fieldName, custom)
      values (10, 'title', 0), (12, 'date', 0);
    insert into creatorTypes (creatorTypeID, creatorType) values (1, 'author');
    insert into itemTypeCreatorTypes (itemTypeID, creatorTypeID, primaryField)
      values (1, 1, 1);
    ${itemRows.length ? `insert into items (itemID, itemTypeID, dateAdded, dateModified, libraryID, key) values ${values(itemRows)};` : ""}
    ${dataValues.length ? `insert into itemDataValues (valueID, value) values ${values(dataValues)};` : ""}
    ${data.length ? `insert into itemData (itemID, fieldID, valueID) values ${values(data)};` : ""}
    ${creators.length ? `insert into creators (creatorID, firstName, lastName, fieldMode) values ${values(creators)};` : ""}
    ${itemCreators.length ? `insert into itemCreators (itemID, creatorID, creatorTypeID, orderIndex) values ${values(itemCreators)};` : ""}
  `;
}

type IndexItemsStream = Stream.Stream<readonly IndexedItem[], unknown>;
type HydrateEffect = Effect.Effect<ReadonlyMap<string, Item>, unknown>;

/** `operation` as a plain call, for a wrapper to forward to. */
const callOf = <A>(operation: unknown) =>
  operation as (payload: object, options?: object) => A;

interface ObservedReads extends AsyncDisposable {
  readonly service: ReturnType<typeof inProcessReadsService>;
  /** The Library of each `IndexItems` call, in call order. */
  readonly indexed: number[];
  /** The Library of each `IndexItems` call that ended interrupted. */
  readonly interrupted: number[];
  readonly signatures: number;
  readonly hydrations: number;
  /**
   * Hold the next `IndexItems` call until `resolve()`. `release()` lets
   * calls after the held one run at once.
   */
  gateIndexItems(): { resolve(): void; release(): void };
  /** Hold the next `ItemsByIndexedKeys` call until `resolve()`. */
  gateHydration(): { resolve(): void };
  /** Inject a `Changes` event, as the worker would send it. */
  emit(event: ChangeEvent): void;
}

/**
 * A reads service on the in-process adapter over seeded `:memory:` databases;
 * open #N runs `seedFor(N)`, and a `null` seed fails the open. The client is
 * observed: calls are recorded, and a test can hold a call or replace it.
 */
function readsOver(
  seedFor: (open: number) => string | null,
  options: {
    opening?: Promise<void>;
    indexItems?: () => IndexItemsStream;
    hydrate?: () => HydrateEffect;
  } = {},
): ObservedReads {
  const indexed: number[] = [];
  const interrupted: number[] = [];
  let signatures = 0;
  let hydrations = 0;
  const indexGates: { promise: Promise<void> }[] = [];
  const hydrationGates: { promise: Promise<void> }[] = [];
  const injected = new Set<(event: ChangeEvent) => void>();
  let releaseAll = false;

  const { open } = memoryOpener(seedFor);
  const wrap = (client: ZoteroReadsClient): ZoteroReadsClient => ({
    ...client,
    IndexItems: ((payload: { libraryID: number }, callOptions?: object) => {
      indexed.push(payload.libraryID);
      const gate = releaseAll ? undefined : indexGates.shift();
      const source =
        options.indexItems?.() ??
        callOf<IndexItemsStream>(client.IndexItems)(payload, callOptions);
      return Stream.unwrap(
        Effect.as(
          Effect.promise(() => gate?.promise ?? Promise.resolve()),
          source,
        ),
      ).pipe(
        Stream.onExit((exit) =>
          Effect.sync(() => {
            if (Exit.hasInterrupts(exit)) interrupted.push(payload.libraryID);
          }),
        ),
      );
    }) as unknown as ZoteroReadsClient["IndexItems"],
    IndexSignature: ((payload: object, callOptions?: object) => {
      signatures += 1;
      return callOf<unknown>(client.IndexSignature)(payload, callOptions);
    }) as unknown as ZoteroReadsClient["IndexSignature"],
    ItemsByIndexedKeys: ((payload: object, callOptions?: object) => {
      hydrations += 1;
      const gate = hydrationGates.shift();
      const source =
        options.hydrate?.() ??
        callOf<HydrateEffect>(client.ItemsByIndexedKeys)(payload, callOptions);
      return Effect.andThen(
        Effect.promise(() => gate?.promise ?? Promise.resolve()),
        source,
      );
    }) as unknown as ZoteroReadsClient["ItemsByIndexedKeys"],
    Changes: ((payload: object, callOptions?: object) =>
      Stream.merge(
        callOf<Stream.Stream<ChangeEvent>>(client.Changes)(
          payload,
          callOptions,
        ),
        Stream.callback<ChangeEvent>((queue) =>
          Effect.sync(() => {
            injected.add((event) => void Queue.offerUnsafe(queue, event));
          }),
        ),
      )) as unknown as ZoteroReadsClient["Changes"],
  });

  const service = inProcessReadsService(open, wrap, options.opening);
  const gate = (gates: { promise: Promise<void> }[]) => {
    const signal = Promise.withResolvers<void>();
    gates.push(signal);
    return signal;
  };
  return {
    service,
    indexed,
    interrupted,
    get signatures() {
      return signatures;
    },
    get hydrations() {
      return hydrations;
    },
    gateIndexItems: () => {
      const signal = gate(indexGates);
      return {
        resolve: () => signal.resolve(),
        release: () => {
          releaseAll = true;
        },
      };
    },
    gateHydration: () => gate(hydrationGates),
    emit: (event) => {
      for (const offer of injected) offer(event);
    },
    [Symbol.asyncDispose]: () => service[Symbol.asyncDispose](),
  };
}

/** An available Library named by its local id; group ids mirror it for brevity. */
function library(libraryID: number): AvailableLibrary {
  return libraryID === USER_LIBRARY_ID
    ? { selector: { type: "personal" }, libraryID, name: null }
    : {
        selector: { type: "group", groupID: libraryID },
        libraryID,
        name: `Group ${libraryID}`,
      };
}

class FakeLibraryScope {
  #libraries: readonly AvailableLibrary[];
  readonly #subscribers = new Set<
    (scope: ResolvedLibraryScope | null) => void
  >();

  readonly ready = Promise.resolve();

  constructor(
    libraries: readonly AvailableLibrary[] = [library(USER_LIBRARY_ID)],
  ) {
    this.#libraries = libraries;
  }

  get current(): ResolvedLibraryScope {
    return this.#resolved();
  }

  get invalid(): boolean {
    return false;
  }

  resolveLibraries(_libraries: readonly Library[]): ResolvedLibraryScope {
    return this.#resolved();
  }

  on(
    _event: "changed",
    cb: (scope: ResolvedLibraryScope | null) => void,
  ): () => void {
    this.#subscribers.add(cb);
    return () => {
      this.#subscribers.delete(cb);
    };
  }

  setLibraries(libraries: readonly AvailableLibrary[]): void {
    this.#libraries = libraries;
    for (const cb of this.#subscribers) cb(this.#resolved());
  }

  #resolved(): ResolvedLibraryScope {
    return {
      mode: "all",
      invalid: false,
      available: this.#libraries,
      unavailable: [],
    };
  }
}
