import { it } from "@effect/vitest";
import {
  Context,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  Queue,
  Scope,
  SubscriptionRef,
} from "effect";
import { isDeepStrictEqual } from "node:util";
import { describe, expect } from "vitest";

import { USER_LIBRARY_ID } from "@zotlit/db";

import type { AvailableLibrary } from "@/services/library-scope/scope";
import { layerRcRef } from "@/services/zotero-reads/connection";
import type { ZoteroReadsClient } from "@/services/zotero-reads/in-process";
import {
  inProcessClient,
  memoryOpener,
} from "@/services/zotero-reads/test-utils";

import {
  layerLibraryScopeOf,
  layerTestItemLookup,
  scopeState,
} from "./__fixtures__";
import { ItemLookup } from "./service";
import type { SearchHit } from "./service";

const keys = (hits: readonly SearchHit[]) => hits.map((hit) => hit.item.key);

describe("ItemLookup", () => {
  it.effect("answers through SearchItems with the Library Scope's ids", () =>
    Effect.gen(function* () {
      const reads = yield* readsOver(() => seed(perLibraryRows()));
      const { lookup } = yield* lookupOver(reads, [
        library(USER_LIBRARY_ID),
        library(2),
      ]);

      const hits = yield* lookup.search("Alpha", { limit: 5 });

      expect(keys(hits)).toEqual(["LIBRARY2", "LIBRARY3"]);
      expect(hits[0]!.matches).toEqual([[0, 5]]);
      expect(reads.searches.at(-1)).toEqual({
        libraryIDs: [USER_LIBRARY_ID, 2],
        query: "Alpha",
        limit: 5,
      });
    }),
  );

  it.effect(
    "prioritizes and labels cited Items, forwarding them only for empty queries",
    () =>
      Effect.gen(function* () {
        const reads = yield* readsOver(() => seed(perLibraryRows()));
        const { lookup } = yield* lookupOver(reads, [
          library(USER_LIBRARY_ID),
          library(2),
        ]);
        const session = yield* lookup.openSession;
        const cited = ["LIBRARY3g2"];
        const empty = yield* session.search(" ", { cited });
        expect(empty.map((hit) => [hit.item.indexedKey, hit.cited])).toEqual([
          ["LIBRARY3g2", true],
          ["LIBRARY2", false],
        ]);
        expect(reads.searches.at(-1)).toMatchObject({ cited });
        const typed = yield* session.search("Alpha", { cited });
        expect(typed.map((hit) => [hit.item.indexedKey, hit.cited])).toEqual([
          ["LIBRARY2", false],
          ["LIBRARY3g2", true],
        ]);
        expect(reads.searches.at(-1)).not.toHaveProperty("cited");
        expect((yield* session.search("")).every((hit) => !hit.cited)).toBe(
          true,
        );
      }),
  );

  it.effect(
    "searches the Libraries a search names in place of the Library Scope, a session's too",
    () =>
      Effect.gen(function* () {
        const reads = yield* readsOver(() => seed(perLibraryRows()));
        const { lookup } = yield* lookupOver(reads, [
          library(USER_LIBRARY_ID),
          library(2),
        ]);

        const hits = yield* lookup.search("Alpha", { libraries: [library(2)] });
        expect(hits.map((hit) => [hit.item.key, hit.library])).toEqual([
          ["LIBRARY3", null],
        ]);
        expect(reads.searches.at(-1)?.libraryIDs).toEqual([2]);

        const session = yield* lookup.openSession;
        yield* session.search("Alpha", {
          libraries: [library(USER_LIBRARY_ID)],
        });
        expect(reads.searches.at(-1)?.libraryIDs).toEqual([USER_LIBRARY_ID]);
      }),
  );

  it.effect("labels hits only when two Libraries are in scope", () =>
    Effect.gen(function* () {
      const reads = yield* readsOver(() => seed(perLibraryRows()));
      const { lookup, setLibraries } = yield* lookupOver(reads);

      expect((yield* lookup.search("")).map((hit) => hit.library)).toEqual([
        null,
      ]);

      yield* setLibraries([library(USER_LIBRARY_ID), library(2)]);
      expect(
        (yield* lookup.search("")).map((hit) => hit.library?.libraryID),
      ).toEqual([USER_LIBRARY_ID, 2]);
    }),
  );

  it.effect(
    "takes labels from the scope it asked with, so a rename shows at once",
    () =>
      Effect.gen(function* () {
        const reads = yield* readsOver(() => seed(perLibraryRows()));
        const { lookup, setLibraries } = yield* lookupOver(reads, [
          library(USER_LIBRARY_ID),
          library(2),
        ]);
        yield* lookup.search("");

        yield* setLibraries([
          library(USER_LIBRARY_ID),
          { ...library(2), name: "Renamed" },
        ]);
        const hits = yield* lookup.search("");

        expect(hits.map((hit) => hit.library?.name)).toEqual([null, "Renamed"]);
      }),
  );

  it.effect(
    "makes the next search after a scope change cover the new list only",
    () =>
      Effect.gen(function* () {
        const reads = yield* readsOver(() => seed(perLibraryRows()));
        const { lookup, setLibraries } = yield* lookupOver(reads);
        expect((yield* lookup.search(""))[0]?.item.libraryID).toBe(
          USER_LIBRARY_ID,
        );

        yield* setLibraries([library(2)]);
        const hits = yield* lookup.search("");

        expect(hits.map((hit) => hit.item.libraryID)).toEqual([2]);
        expect(reads.searches.at(-1)?.libraryIDs).toEqual([2]);
      }),
  );

  it.effect("answers empty when the database is unavailable", () =>
    Effect.gen(function* () {
      const reads = yield* readsOver(() => null);
      const { lookup } = yield* lookupOver(reads);

      expect(yield* lookup.search("anything")).toEqual([]);
    }),
  );

  it.effect(
    "answers empty without a request while no Library is in scope",
    () =>
      Effect.gen(function* () {
        const reads = yield* readsOver(() => seed(perLibraryRows()));
        const { lookup, setLibraries } = yield* lookupOver(reads, null);

        expect(yield* lookup.search("")).toEqual([]);
        yield* setLibraries([]);
        expect(yield* lookup.search("")).toEqual([]);
        expect(reads.searches).toEqual([]);
      }),
  );

  it.effect("answers empty for a limit of zero", () =>
    Effect.gen(function* () {
      const reads = yield* readsOver(() => seed(perLibraryRows()));
      const { lookup } = yield* lookupOver(reads);
      yield* Queue.take(reads.calls);
      const before = reads.searches.length;

      expect(yield* lookup.search("", { limit: 0 })).toEqual([]);
      expect(reads.searches).toHaveLength(before);
    }),
  );

  it.effect(
    "interrupts the previous request when the next keystroke searches, and answers both with the newest list",
    () =>
      Effect.gen(function* () {
        const reads = yield* readsOver(() => seed(perLibraryRows()));
        const { lookup } = yield* lookupOver(reads, [
          library(USER_LIBRARY_ID),
          library(2),
        ]);
        yield* lookup.search("");
        const session = yield* lookup.openSession;
        const gate = yield* reads.gateSearch;

        const first = yield* Effect.forkChild(session.search("Alpha"));
        yield* gate.entered;
        const second = yield* session.search("LIBRARY3");

        expect(keys(second)).toEqual(["LIBRARY3"]);
        // A list drawn from the interrupted answer still matches the box.
        expect(keys(yield* Fiber.join(first))).toEqual(["LIBRARY3"]);
        expect(reads.interrupted).toEqual(["Alpha"]);
      }),
  );

  it.effect(
    "answers a chain of interrupted keystrokes with the newest list",
    () =>
      Effect.gen(function* () {
        const reads = yield* readsOver(() => seed(perLibraryRows()));
        const { lookup } = yield* lookupOver(reads, [
          library(USER_LIBRARY_ID),
          library(2),
        ]);
        yield* lookup.search("");
        const session = yield* lookup.openSession;
        const gates = [yield* reads.gateSearch, yield* reads.gateSearch];

        const first = yield* Effect.forkChild(session.search("A"));
        yield* gates[0]!.entered;
        const second = yield* Effect.forkChild(session.search("Al"));
        yield* gates[1]!.entered;
        const third = yield* session.search("LIBRARY2");

        const answers = [yield* Fiber.join(first), yield* Fiber.join(second)];
        expect([...answers, third].map(keys)).toEqual([
          ["LIBRARY2"],
          ["LIBRARY2"],
          ["LIBRARY2"],
        ]);
        expect(reads.interrupted).toEqual(["A", "Al"]);
      }),
  );

  it.effect("runs two sessions side by side, each answering its own list", () =>
    Effect.gen(function* () {
      const reads = yield* readsOver(() => seed(perLibraryRows()));
      const { lookup } = yield* lookupOver(reads, [
        library(USER_LIBRARY_ID),
        library(2),
      ]);
      yield* lookup.search("");
      const picker = yield* lookup.openSession;
      const suggester = yield* lookup.openSession;
      const gates = [yield* reads.gateSearch, yield* reads.gateSearch];

      const first = yield* Effect.forkChild(picker.search("Alpha"));
      yield* gates[0]!.entered;
      const second = yield* Effect.forkChild(suggester.search("LIBRARY3"));
      yield* gates[1]!.entered;
      for (const gate of gates) yield* gate.open;

      expect(keys(yield* Fiber.join(first))).toEqual(["LIBRARY2", "LIBRARY3"]);
      expect(keys(yield* Fiber.join(second))).toEqual(["LIBRARY3"]);
      expect(reads.interrupted).toEqual([]);
    }),
  );

  it.effect(
    "answers each one-shot search with its own list, beside a session's keystrokes and each other",
    () =>
      Effect.gen(function* () {
        const reads = yield* readsOver(() => seed(perLibraryRows()));
        const { lookup } = yield* lookupOver(reads, [
          library(USER_LIBRARY_ID),
          library(2),
        ]);
        yield* lookup.search("");
        const session = yield* lookup.openSession;
        const gates = [
          yield* reads.gateSearch,
          yield* reads.gateSearch,
          yield* reads.gateSearch,
        ];

        const recent = yield* Effect.forkChild(lookup.search("", { limit: 1 }));
        yield* gates[0]!.entered;
        const other = yield* Effect.forkChild(lookup.search("LIBRARY3"));
        yield* gates[1]!.entered;
        const keystroke = yield* Effect.forkChild(session.search("Alpha"));
        yield* gates[2]!.entered;
        expect(yield* session.search("LIBRARY2")).toHaveLength(1);
        for (const gate of gates) yield* gate.open;

        expect(keys(yield* Fiber.join(recent))).toEqual(["LIBRARY2"]);
        expect(keys(yield* Fiber.join(other))).toEqual(["LIBRARY3"]);
        expect(keys(yield* Fiber.join(keystroke))).toEqual(["LIBRARY2"]);
        expect(reads.interrupted).toEqual(["Alpha"]);
      }),
  );

  it.effect(
    "interrupts a session's pending search on close, and answers it and every later search empty",
    () =>
      Effect.gen(function* () {
        const reads = yield* readsOver(() => seed(perLibraryRows()));
        const { lookup } = yield* lookupOver(reads);
        yield* lookup.search("");
        const sessionScope = yield* Scope.make();
        const session = yield* Scope.provide(lookup.openSession, sessionScope);
        const gate = yield* reads.gateSearch;

        const pending = yield* Effect.forkChild(session.search("Alpha"));
        yield* gate.entered;
        yield* Scope.close(sessionScope, Exit.void);

        expect(yield* Fiber.join(pending)).toEqual([]);
        expect(reads.interrupted).toEqual(["Alpha"]);
        const before = reads.searches.length;
        expect(yield* session.search("Alpha")).toEqual([]);
        expect(reads.searches).toHaveLength(before);
      }),
  );

  it.effect("prewarms with an empty query and a limit of one on start", () =>
    Effect.gen(function* () {
      const reads = yield* readsOver(() => seed(perLibraryRows()));
      yield* lookupOver(reads);

      expect(yield* Queue.take(reads.calls)).toEqual({
        libraryIDs: [USER_LIBRARY_ID],
        query: "",
        uses: {},
        limit: 1,
      });
      expect(reads.searches).toHaveLength(1);
    }),
  );

  it.effect("prewarms the new list on a Library Scope change", () =>
    Effect.gen(function* () {
      const reads = yield* readsOver(() => seed(perLibraryRows()));
      const { setLibraries } = yield* lookupOver(reads);
      yield* Queue.take(reads.calls);

      yield* setLibraries([library(USER_LIBRARY_ID), library(2)]);

      expect(reads.searches.at(-1)).toEqual({
        libraryIDs: [USER_LIBRARY_ID, 2],
        query: "",
        uses: {},
        limit: 1,
      });
    }),
  );

  it.effect(
    "keeps a pending search running through a rename and its prewarm",
    () =>
      Effect.gen(function* () {
        const reads = yield* readsOver(() => seed(perLibraryRows()));
        const { lookup, setLibraries } = yield* lookupOver(reads, [
          library(USER_LIBRARY_ID),
          library(2),
        ]);
        yield* lookup.search("");
        const session = yield* lookup.openSession;
        const gate = yield* reads.gateSearch;

        const search = yield* Effect.forkChild(session.search("Alpha"));
        yield* gate.entered;
        yield* setLibraries([
          library(USER_LIBRARY_ID),
          { ...library(2), name: "Renamed" },
        ]);
        yield* gate.open;

        expect(yield* Fiber.join(search)).toHaveLength(2);
        expect(reads.interrupted).toEqual([]);
      }),
  );

  it.effect(
    "drops a pending search's answer when a database switch gives its local id to another group",
    () =>
      Effect.gen(function* () {
        const reads = yield* readsOver(() => seed(perLibraryRows()));
        const group = (groupID: number): AvailableLibrary => ({
          selector: { type: "group", groupID },
          libraryID: 2,
          name: `Group ${groupID}`,
        });
        const { lookup, setLibraries } = yield* lookupOver(reads, [group(10)]);
        yield* lookup.search("");
        const session = yield* lookup.openSession;
        const gate = yield* reads.gateSearch;

        const search = yield* Effect.forkChild(session.search("Alpha"));
        yield* gate.entered;
        yield* setLibraries([group(20)]);

        expect(yield* Fiber.join(search)).toEqual([]);
        expect(reads.interrupted).toEqual(["Alpha"]);
      }),
  );

  it.effect(
    "drops the pending search of every open session when the scope changes",
    () =>
      Effect.gen(function* () {
        const reads = yield* readsOver(() => seed(perLibraryRows()));
        const { lookup, setLibraries } = yield* lookupOver(reads);
        yield* lookup.search("");
        const picker = yield* lookup.openSession;
        const suggester = yield* lookup.openSession;
        const gates = [yield* reads.gateSearch, yield* reads.gateSearch];

        const pending = [
          yield* Effect.forkChild(picker.search("Alpha")),
          yield* Effect.forkChild(suggester.search("LIBRARY2")),
        ];
        for (const gate of gates) yield* gate.entered;
        yield* setLibraries([library(2)]);

        expect(yield* Fiber.joinAll(pending)).toEqual([[], []]);
        expect(reads.interrupted.toSorted()).toEqual(["Alpha", "LIBRARY2"]);
      }),
  );

  it.effect.each<[string, readonly AvailableLibrary[]]>([
    ["another Library", [library(2)]],
    ["no Library", []],
  ])(
    "drops a pending search's answer when the scope changes to %s",
    ([, libraries]) =>
      Effect.gen(function* () {
        const reads = yield* readsOver(() => seed(perLibraryRows()));
        const { lookup, setLibraries } = yield* lookupOver(reads);
        yield* lookup.search("");
        const gate = yield* reads.gateSearch;

        const search = yield* Effect.forkChild(lookup.search("Alpha"));
        yield* gate.entered;
        yield* setLibraries(libraries);

        expect(yield* Fiber.join(search)).toEqual([]);
        expect(reads.interrupted).toEqual(["Alpha"]);
      }),
  );
});

/**
 * The Item search over `reads`, with a Library Scope that holds `libraries`
 * (unresolved for `null`), open for the case's Scope. `setLibraries` changes
 * the scope, and returns once the search has seen the change: after the
 * prewarm of a non-empty list.
 */
const lookupOver = Effect.fnUntraced(function* (
  reads: ObservedReads,
  libraries: readonly AvailableLibrary[] | null = [library(USER_LIBRARY_ID)],
) {
  const state = yield* SubscriptionRef.make(scopeState(libraries));
  const context = yield* Layer.build(
    layerTestItemLookup(reads.client, layerLibraryScopeOf(state)),
  );
  return {
    lookup: Context.get(context, ItemLookup),
    setLibraries: (next: readonly AvailableLibrary[]) =>
      Effect.gen(function* () {
        yield* SubscriptionRef.set(state, scopeState(next));
        if (next.length === 0) return;
        const libraryIDs = next.map((entry) => entry.libraryID);
        yield* Queue.take(reads.calls).pipe(
          Effect.repeat({
            until: (call) =>
              call.limit === 1 &&
              call.query === "" &&
              isDeepStrictEqual(call.libraryIDs, libraryIDs),
          }),
        );
      }),
  };
});

interface SearchPayload {
  libraryIDs: readonly number[];
  query: string;
  limit: number;
}

/** A held `SearchItems` call: `entered` once it waits, `open` lets it run. */
interface Gate {
  readonly entered: Effect.Effect<void>;
  readonly open: Effect.Effect<void>;
}

interface ObservedReads {
  readonly client: Effect.Effect<ZoteroReadsClient, never, Scope.Scope>;
  /** The payload of each `SearchItems` call, in call order. */
  readonly searches: SearchPayload[];
  /** Each `SearchItems` call's payload, as it is made. */
  readonly calls: Queue.Queue<SearchPayload>;
  /** The query of each `SearchItems` call that ended interrupted. */
  readonly interrupted: string[];
  /** Hold the next `SearchItems` call until its gate opens. */
  readonly gateSearch: Effect.Effect<Gate>;
}

/**
 * A reads client on the in-process adapter over seeded `:memory:` databases;
 * open #N runs `seedFor(N)`, and a `null` seed fails the open. `SearchItems`
 * is observed: each call is recorded, and a test can hold the next one.
 */
const readsOver = Effect.fnUntraced(function* (
  seedFor: (open: number) => string | null,
) {
  const searches: SearchPayload[] = [];
  const interrupted: string[] = [];
  const calls = yield* Queue.unbounded<SearchPayload>();
  const gates: {
    entered: Deferred.Deferred<void>;
    open: Deferred.Deferred<void>;
  }[] = [];

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
      return Queue.offer(calls, payload).pipe(
        Effect.andThen(
          gate
            ? Deferred.succeed(gate.entered, undefined).pipe(
                Effect.andThen(Deferred.await(gate.open)),
              )
            : Effect.void,
        ),
        Effect.andThen(call),
        Effect.onInterrupt(() =>
          Effect.sync(() => interrupted.push(payload.query)),
        ),
      );
    }) as unknown as ZoteroReadsClient["SearchItems"],
  });

  const reads: ObservedReads = {
    client: Effect.map(
      inProcessClient(layerRcRef(memoryOpener(seedFor).open)),
      (client) => wrap(client),
    ),
    searches,
    calls,
    interrupted,
    gateSearch: Effect.gen(function* () {
      const gate = {
        entered: yield* Deferred.make<void>(),
        open: yield* Deferred.make<void>(),
      };
      gates.push(gate);
      return {
        entered: Deferred.await(gate.entered),
        open: Effect.asVoid(Deferred.succeed(gate.open, undefined)),
      };
    }),
  };
  return reads;
});

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
