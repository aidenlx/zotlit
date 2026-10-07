import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { USER_LIBRARY_ID } from "@zotlit/db";
import type { Library } from "@zotlit/db";

import type {
  AvailableLibrary,
  ResolvedLibraryScope,
} from "@/services/library-scope/scope";
import type { LibraryScopeService } from "@/services/library-scope/service";
import type { ZoteroReadsClient } from "@/services/zotero-reads/in-process";
import {
  inProcessReadsService,
  memoryOpener,
} from "@/services/zotero-reads/test-utils";

import { ItemLookup } from "./service";
import type { SearchHit } from "./service";

describe("ItemLookup", () => {
  it("answers through SearchItems with the Library Scope's ids", async () => {
    await using reads = readsOver(() => seed(perLibraryRows()));
    await using lookup = itemLookup(
      reads,
      new FakeLibraryScope([library(USER_LIBRARY_ID), library(2)]),
    );

    const hits = await lookup.search("Alpha", { limit: 5 });

    expect(hits.map((hit) => hit.item.key)).toEqual(["LIBRARY2", "LIBRARY3"]);
    expect(hits[0]!.matches).toEqual([[0, 5]]);
    expect(reads.searches.at(-1)).toEqual({
      libraryIDs: [USER_LIBRARY_ID, 2],
      query: "Alpha",
      limit: 5,
    });
  });

  it("labels hits only when two Libraries are in scope", async () => {
    await using reads = readsOver(() => seed(perLibraryRows()));
    const libraryScope = new FakeLibraryScope();
    await using lookup = itemLookup(reads, libraryScope);

    expect((await lookup.search("")).map((hit) => hit.library)).toEqual([null]);

    libraryScope.setLibraries([library(USER_LIBRARY_ID), library(2)]);
    expect(
      (await lookup.search("")).map((hit) => hit.library?.libraryID),
    ).toEqual([USER_LIBRARY_ID, 2]);
  });

  it("takes labels from the scope it asked with, so a rename shows at once", async () => {
    await using reads = readsOver(() => seed(perLibraryRows()));
    const libraryScope = new FakeLibraryScope([
      library(USER_LIBRARY_ID),
      library(2),
    ]);
    await using lookup = itemLookup(reads, libraryScope);
    await lookup.search("");

    libraryScope.setLibraries([
      library(USER_LIBRARY_ID),
      { ...library(2), name: "Renamed" },
    ]);
    const hits = await lookup.search("");

    expect(hits.map((hit) => hit.library?.name)).toEqual([null, "Renamed"]);
  });

  it("makes the next search after a scope change cover the new list only", async () => {
    await using reads = readsOver(() => seed(perLibraryRows()));
    const libraryScope = new FakeLibraryScope();
    await using lookup = itemLookup(reads, libraryScope);
    expect((await lookup.search(""))[0]?.item.libraryID).toBe(USER_LIBRARY_ID);

    libraryScope.setLibraries([library(2)]);
    const hits = await lookup.search("");

    expect(hits.map((hit) => hit.item.libraryID)).toEqual([2]);
    expect(reads.searches.at(-1)?.libraryIDs).toEqual([2]);
  });

  it("answers empty when the database is unavailable", async () => {
    await using reads = readsOver(() => null);
    await using lookup = itemLookup(reads);

    await expect(lookup.search("anything")).resolves.toEqual([]);
  });

  it("answers empty without a request while no Library is in scope", async () => {
    await using reads = readsOver(() => seed(perLibraryRows()));
    const libraryScope = new FakeLibraryScope(null);
    await using lookup = itemLookup(reads, libraryScope);

    await expect(lookup.search("")).resolves.toEqual([]);
    libraryScope.setLibraries([]);
    await expect(lookup.search("")).resolves.toEqual([]);
    expect(reads.searches).toEqual([]);
  });

  it("answers empty for a limit of zero", async () => {
    await using reads = readsOver(() => seed(perLibraryRows()));
    await using lookup = itemLookup(reads);
    await lookup.ready;
    const before = reads.searches.length;

    await expect(lookup.search("", { limit: 0 })).resolves.toEqual([]);
    expect(reads.searches).toHaveLength(before);
  });

  it("interrupts the previous request when the next keystroke searches, and answers both with the newest list", async () => {
    await using reads = readsOver(() => seed(perLibraryRows()));
    await using lookup = itemLookup(
      reads,
      new FakeLibraryScope([library(USER_LIBRARY_ID), library(2)]),
    );
    await lookup.search("");
    const gate = reads.gateSearch();

    const first = lookup.search("Alpha");
    await expect.poll(() => reads.held).toBe(1);
    const second = lookup.search("LIBRARY3");

    const keys = async (answer: Promise<SearchHit[]>) =>
      (await answer).map((hit) => hit.item.key);
    expect(await keys(second)).toEqual(["LIBRARY3"]);
    // A list drawn from the interrupted answer still matches the box.
    expect(await keys(first)).toEqual(["LIBRARY3"]);
    expect(reads.interrupted).toEqual(["Alpha"]);
    gate.resolve();
  });

  it("answers a chain of interrupted keystrokes with the newest list", async () => {
    await using reads = readsOver(() => seed(perLibraryRows()));
    await using lookup = itemLookup(
      reads,
      new FakeLibraryScope([library(USER_LIBRARY_ID), library(2)]),
    );
    await lookup.search("");
    const gates = [reads.gateSearch(), reads.gateSearch()];

    const first = lookup.search("A");
    await expect.poll(() => reads.held).toBe(1);
    const second = lookup.search("Al");
    await expect.poll(() => reads.searches.at(-1)?.query).toBe("Al");
    const third = lookup.search("LIBRARY2");

    const answers = await Promise.all([first, second, third]);
    expect(answers.map((answer) => answer.map((hit) => hit.item.key))).toEqual([
      ["LIBRARY2"],
      ["LIBRARY2"],
      ["LIBRARY2"],
    ]);
    expect(reads.interrupted).toEqual(["A", "Al"]);
    for (const gate of gates) gate.resolve();
  });

  it("prewarms with an empty query and a limit of one on ready", async () => {
    await using reads = readsOver(() => seed(perLibraryRows()));
    await using lookup = itemLookup(reads);

    await lookup.ready;

    await expect
      .poll(() => reads.searches)
      .toEqual([{ libraryIDs: [USER_LIBRARY_ID], query: "", limit: 1 }]);
  });

  it("prewarms the new list on a Library Scope change", async () => {
    await using reads = readsOver(() => seed(perLibraryRows()));
    const libraryScope = new FakeLibraryScope();
    await using lookup = itemLookup(reads, libraryScope);
    await lookup.ready;
    await expect.poll(() => reads.searches).toHaveLength(1);

    libraryScope.setLibraries([library(USER_LIBRARY_ID), library(2)]);

    await expect
      .poll(() => reads.searches.at(-1))
      .toEqual({ libraryIDs: [USER_LIBRARY_ID, 2], query: "", limit: 1 });
  });

  it("keeps a search running while a prewarm runs", async () => {
    await using reads = readsOver(() => seed(perLibraryRows()));
    const libraryScope = new FakeLibraryScope();
    await using lookup = itemLookup(reads, libraryScope);
    await lookup.search("");
    const gate = reads.gateSearch();

    const search = lookup.search("Alpha");
    await expect.poll(() => reads.held).toBe(1);
    libraryScope.setLibraries([library(USER_LIBRARY_ID), library(2)]);
    await expect.poll(() => reads.searches.at(-1)?.limit).toBe(1);
    gate.resolve();

    await expect(search).resolves.toHaveLength(1);
    expect(reads.interrupted).toEqual([]);
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

interface SearchPayload {
  libraryIDs: readonly number[];
  query: string;
  limit: number;
}

interface ObservedReads extends AsyncDisposable {
  readonly service: ReturnType<typeof inProcessReadsService>;
  /** The payload of each `SearchItems` call, in call order. */
  readonly searches: SearchPayload[];
  /** The query of each `SearchItems` call that ended interrupted. */
  readonly interrupted: string[];
  /** `SearchItems` calls the gate holds now. */
  readonly held: number;
  /** Hold the next `SearchItems` call until `resolve()`. */
  gateSearch(): { resolve(): void };
}

/**
 * A reads service on the in-process adapter over seeded `:memory:` databases;
 * open #N runs `seedFor(N)`, and a `null` seed fails the open. `SearchItems`
 * is observed: each call is recorded, and a test can hold the next one.
 */
function readsOver(seedFor: (open: number) => string | null): ObservedReads {
  const searches: SearchPayload[] = [];
  const interrupted: string[] = [];
  const gates: Promise<void>[] = [];
  let held = 0;

  const wrap = (client: ZoteroReadsClient): ZoteroReadsClient => ({
    ...client,
    SearchItems: ((payload: SearchPayload, options?: object) => {
      searches.push(payload);
      const gate = gates.shift();
      const call = (
        client.SearchItems as (
          payload: SearchPayload,
          options?: object,
        ) => Effect.Effect<unknown, unknown>
      )(payload, options);
      return Effect.andThen(
        gate
          ? Effect.acquireUseRelease(
              Effect.sync(() => (held += 1)),
              () => Effect.promise(() => gate),
              () => Effect.sync(() => (held -= 1)),
            )
          : Effect.void,
        call,
      ).pipe(
        Effect.onInterrupt(() =>
          Effect.sync(() => interrupted.push(payload.query)),
        ),
      );
    }) as unknown as ZoteroReadsClient["SearchItems"],
  });

  const service = inProcessReadsService(memoryOpener(seedFor).open, { wrap });
  return {
    service,
    searches,
    interrupted,
    get held() {
      return held;
    },
    gateSearch: () => {
      const signal = Promise.withResolvers<void>();
      gates.push(signal.promise);
      return { resolve: () => signal.resolve() };
    },
    [Symbol.asyncDispose]: () => service[Symbol.asyncDispose](),
  };
}

/** One "Alpha" journal article per Library, keyed `LIBRARY<libraryID + 1>`. */
function perLibraryRows(): {
  key: string;
  itemID: number;
  libraryID: number;
}[] {
  return [USER_LIBRARY_ID, 2].map((libraryID) => ({
    key: `LIBRARY${libraryID + 1}`,
    itemID: libraryID * 100,
    libraryID,
  }));
}

/**
 * SQL for a user library (1) and a group library (2, group 2) holding `rows`
 * as journal articles titled "Alpha"; the user library's row is the newer.
 */
function seed(
  rows: readonly { key: string; itemID: number; libraryID: number }[],
): string {
  const items = rows
    .map(
      (r) =>
        `(${r.itemID}, 1, '2024-01-01 00:00:00', '2024-01-0${r.libraryID === USER_LIBRARY_ID ? 2 : 1} 00:00:00', ${r.libraryID}, '${r.key}')`,
    )
    .join(", ");
  const data = rows.map((r) => `(${r.itemID}, 10, 1)`).join(", ");
  return `
    insert into libraries (libraryID, type, version, clientVersion)
      values (1, 'user', 1, 0), (2, 'group', 1, 0);
    insert into groups (groupID, libraryID, name) values (2, 2, 'Group 2');
    insert into itemTypes (itemTypeID, typeName) values (1, 'journalArticle');
    insert into fieldsCombined (fieldID, fieldName, custom) values (10, 'title', 0);
    insert into itemDataValues (valueID, value) values (1, 'Alpha');
    insert into items (itemID, itemTypeID, dateAdded, dateModified, libraryID, key)
      values ${items};
    insert into itemData (itemID, fieldID, valueID) values ${data};
  `;
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
  #libraries: readonly AvailableLibrary[] | null;
  readonly #subscribers = new Set<
    (scope: ResolvedLibraryScope | null) => void
  >();

  readonly ready = Promise.resolve();

  /** `null` leaves the scope unresolved. */
  constructor(
    libraries: readonly AvailableLibrary[] | null = [library(USER_LIBRARY_ID)],
  ) {
    this.#libraries = libraries;
  }

  get current(): ResolvedLibraryScope | null {
    return this.#resolved();
  }

  resolveLibraries(_libraries: readonly Library[]): ResolvedLibraryScope {
    return this.#resolved()!;
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

  #resolved(): ResolvedLibraryScope | null {
    return (
      this.#libraries && {
        mode: "all",
        invalid: false,
        available: this.#libraries,
        unavailable: [],
      }
    );
  }
}
