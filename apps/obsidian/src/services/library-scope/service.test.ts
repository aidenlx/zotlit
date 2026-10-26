import { it } from "@effect/vitest";
import { Deferred, Effect, Stream } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, vi } from "vitest";

import type { Library } from "@zotlit/db";

import { subscribe } from "@/lib/effect-stream";
import { layerRcRef } from "@/services/zotero-reads/connection";
import { DbUnavailable } from "@/services/zotero-reads/rpc";
import {
  inProcessClient,
  memoryOpener,
} from "@/services/zotero-reads/test-utils";

import { libraryScopeFixture } from "./__fixtures__";
import type { LibraryScope as SavedScope, ResolvedLibraryScope } from "./scope";
import { LIBRARY_SCOPE_KEY } from "./service";

// Group-id order differs from local library-id order.
const MY_LIBRARY: Library = {
  libraryID: 1,
  version: 0,
  clientVersion: null,
  type: "user",
  groupID: null,
  name: null,
};
const GROUP_200: Library = {
  ...MY_LIBRARY,
  libraryID: 3,
  type: "group",
  groupID: 200,
  name: "Shared B",
};
const GROUP_100: Library = {
  ...MY_LIBRARY,
  libraryID: 7,
  type: "group",
  groupID: 100,
  name: "Shared A",
};

const changedScope = (
  f: Fixture,
  predicate: (scope: ResolvedLibraryScope | null) => boolean,
) =>
  Stream.runHead(
    f.service.changes.pipe(Stream.filter((state) => predicate(state.current))),
  );

describe("LibraryScope", () => {
  it.effect("resolves the saved scope before acquisition finishes", () =>
    Effect.gen(function* () {
      const f = yield* makeService();
      expect(f.plain.current).toMatchObject({
        mode: "all",
        invalid: false,
        available: [
          { selector: { type: "personal" }, libraryID: 1, name: null },
          { selector: { type: "group", groupID: 100 }, libraryID: 7 },
          { selector: { type: "group", groupID: 200 }, libraryID: 3 },
        ],
      });
    }),
  );

  it.effect("emits nothing for an equivalent refresh", () =>
    Effect.gen(function* () {
      const f = yield* makeService();
      const before = f.plain.current;
      yield* f.refresh([MY_LIBRARY, GROUP_200, GROUP_100]);
      expect(f.plain.current).toBe(before);
      expect(f.changed).not.toHaveBeenCalled();
    }),
  );

  it.effect("emits a change when a group is renamed", () =>
    Effect.gen(function* () {
      const f = yield* makeService();
      yield* f.refresh([
        MY_LIBRARY,
        GROUP_200,
        { ...GROUP_100, name: "Renamed" },
      ]);
      yield* changedScope(
        f,
        (scope) => scope?.available[1]?.name === "Renamed",
      );
      expect(f.plain.current?.available[1]?.name).toBe("Renamed");
      yield* Effect.promise(() =>
        expect.poll(() => f.changed.mock.calls.length).toBe(1),
      );
    }),
  );

  it.effect(
    "reports changed Libraries outside the saved scope without changing its resolution",
    () =>
      Effect.gen(function* () {
        const f = yield* makeService({
          scope: { mode: "selected", libraries: [{ type: "personal" }] },
        });
        const before = f.plain.current;
        const changed = vi.fn();
        subscribe(f.runtime, f.plain["libraries-changed"], changed);
        yield* f.refresh([
          MY_LIBRARY,
          GROUP_200,
          { ...GROUP_100, name: "Renamed" },
        ]);
        yield* Effect.promise(() =>
          expect.poll(() => f.plain.libraries[1]?.name).toBe("Renamed"),
        );
        yield* Effect.promise(() =>
          expect.poll(() => changed.mock.calls.length).toBe(1),
        );
        expect(f.plain.current).toBe(before);
        expect(f.changed).not.toHaveBeenCalled();
      }),
  );

  it.effect("gives a returning group its current local library id", () =>
    Effect.gen(function* () {
      const f = yield* makeService({
        libraries: [MY_LIBRARY],
        scope: {
          mode: "selected",
          libraries: [{ type: "personal" }, { type: "group", groupID: 100 }],
        },
      });
      expect(f.plain.current?.unavailable).toEqual([
        { type: "group", groupID: 100 },
      ]);
      yield* f.refresh([MY_LIBRARY, { ...GROUP_100, libraryID: 11 }]);
      yield* changedScope(f, (scope) => scope?.unavailable.length === 0);
      expect(f.plain.current?.available[1]?.libraryID).toBe(11);
    }),
  );

  it.effect("replays an unreadable database to a late subscriber", () =>
    Effect.gen(function* () {
      const f = yield* makeService({ libraries: null });
      expect(f.plain.current).toBeNull();
      expect(f.plain.libraries).toEqual([]);
      expect(yield* Stream.runHead(f.service.changes)).toMatchObject({
        value: { current: null, libraryRows: null },
      });
    }),
  );

  it.effect("holds the previous scope while a replacement read runs", () =>
    Effect.gen(function* () {
      const f = yield* makeService();
      const before = f.plain.current;
      const gate = yield* f.gateLibraries();
      yield* f.refreshSource([MY_LIBRARY]);
      yield* Deferred.await(gate.waiting);
      expect(f.plain.current).toBe(before);
      yield* Deferred.succeed(gate.release, undefined);
      yield* changedScope(f, (scope) => scope?.available.length === 1);
    }),
  );

  it.effect(
    "holds the previous scope on a failed read and retries after cooldown",
    () =>
      Effect.gen(function* () {
        const f = yield* makeService();
        const before = f.plain.current;
        f.failLibraries(true);
        yield* f.refreshSource([MY_LIBRARY]);
        yield* Effect.promise(() =>
          expect.poll(() => f.librariesFailed).toBeGreaterThan(0),
        );
        expect(f.plain.current).toBe(before);
        f.failLibraries(false);
        yield* TestClock.adjust("10 seconds");
        expect(f.plain.current).toBe(before);
        yield* changedScope(f, (scope) => scope?.available.length === 1);
      }),
  );

  it.effect("holds the previous scope when a database refresh fails", () =>
    Effect.gen(function* () {
      const f = yield* makeService();
      const before = f.plain.current;
      yield* f.refreshSource(null);
      expect(f.plain.current).toBe(before);
      expect(f.changed).not.toHaveBeenCalled();
    }),
  );

  it.effect("separates an unreadable database from zero Libraries", () =>
    Effect.gen(function* () {
      const f = yield* makeService({ libraries: [] });
      expect(f.plain.current).toEqual({
        mode: "all",
        invalid: false,
        available: [],
        unavailable: [],
      });
    }),
  );

  it.effect("falls back to My Library for a broken saved value", () =>
    Effect.gen(function* () {
      const f = yield* makeService({ broken: true });
      expect(yield* f.service.invalid).toBe(true);
      expect(f.plain.current).toMatchObject({
        mode: "selected",
        invalid: true,
        available: [{ selector: { type: "personal" }, libraryID: 1 }],
      });
    }),
  );

  it.effect("replays a broken saved value even with no readable database", () =>
    Effect.gen(function* () {
      const f = yield* makeService({ broken: true, libraries: null });
      expect(yield* Stream.runHead(f.service.changes)).toMatchObject({
        value: {
          current: null,
          invalid: true,
          effective: { mode: "selected", libraries: [{ type: "personal" }] },
        },
      });
    }),
  );

  it.effect("emits a change when a repair clears the broken value", () =>
    Effect.gen(function* () {
      const f = yield* makeService({ broken: true });
      f.bridge.runSync(
        f.settings.update({ [LIBRARY_SCOPE_KEY]: { mode: "all" } }),
      );
      yield* changedScope(f, (scope) => scope?.invalid === false);
      expect(yield* f.service.invalid).toBe(false);
      expect(f.plain.current?.mode).toBe("all");
      yield* Effect.promise(() =>
        expect.poll(() => f.changed.mock.calls.length).toBe(1),
      );
    }),
  );

  it.effect("emits a change when the user selects a different scope", () =>
    Effect.gen(function* () {
      const f = yield* makeService();
      f.bridge.runSync(
        f.settings.update({
          [LIBRARY_SCOPE_KEY]: {
            mode: "selected",
            libraries: [{ type: "group", groupID: 200 }],
          },
        }),
      );
      yield* changedScope(f, (scope) => scope?.mode === "selected");
      expect(f.plain.current?.available).toEqual([
        {
          selector: { type: "group", groupID: 200 },
          libraryID: 3,
          name: "Shared B",
        },
      ]);
    }),
  );

  it.effect(
    "resolves a caller's Snapshot independently of the held Libraries",
    () =>
      Effect.gen(function* () {
        const f = yield* makeService();
        yield* f.refresh([MY_LIBRARY]);
        yield* changedScope(f, (scope) => scope?.available.length === 1);
        expect(
          f.plain.resolveLibraries([MY_LIBRARY, GROUP_200, GROUP_100])
            .available,
        ).toHaveLength(3);
      }),
  );
});

function librariesSql(libraries: readonly Library[] | null): string | null {
  if (libraries === null) return null;
  return libraries
    .map(
      (library) =>
        `insert into libraries (libraryID, type) values (${library.libraryID}, '${library.type}');${library.groupID === null ? "" : `insert into groups (groupID, libraryID, name) values (${library.groupID}, ${library.libraryID}, '${library.name}');`}`,
    )
    .join("\n");
}

type Fixture = Effect.Success<ReturnType<typeof makeService>>;
const makeService = Effect.fnUntraced(function* (
  options: {
    libraries?: readonly Library[] | null;
    scope?: SavedScope;
    broken?: boolean;
  } = {},
) {
  const opens = [
    options.libraries === undefined
      ? [MY_LIBRARY, GROUP_200, GROUP_100]
      : options.libraries,
  ];
  let gate:
    | { waiting: Deferred.Deferred<void>; release: Deferred.Deferred<void> }
    | undefined;
  let failing = false;
  let librariesRead = 0;
  let librariesFailed = 0;
  const client = Effect.map(
    inProcessClient(
      layerRcRef(memoryOpener((n) => librariesSql(opens[n - 1] ?? null)).open),
    ),
    (client) => ({
      ...client,
      Libraries: ((...args: Parameters<typeof client.Libraries>) =>
        Effect.gen(function* () {
          if (gate) {
            yield* Deferred.succeed(gate.waiting, undefined);
            yield* Deferred.await(gate.release);
          }
          if (failing) {
            librariesFailed++;
            return yield* new DbUnavailable({ message: "the read failed" });
          }
          const rows = yield* client.Libraries(...args);
          librariesRead++;
          return rows;
        })) as typeof client.Libraries,
    }),
  );
  const f = yield* libraryScopeFixture(client, {
    __VERSION__: 11,
    [LIBRARY_SCOPE_KEY]: options.broken
      ? "nonsense"
      : (options.scope ?? { mode: "all" }),
  });
  yield* Effect.promise(() =>
    expect.poll(() => f.reads.state).not.toBe("loading"),
  );
  const changed = vi.fn<(scope: ResolvedLibraryScope | null) => void>();
  subscribe(f.runtime, f.plain["changed"], changed);
  const refreshSource = Effect.fnUntraced(function* (
    libraries: readonly Library[] | null,
  ) {
    opens.push(libraries);
    yield* Effect.promise(() => f.reads.refresh().catch(() => {}));
  });
  return {
    ...f,
    changed,
    get librariesFailed() {
      return librariesFailed;
    },
    refreshSource,
    refresh: Effect.fnUntraced(function* (libraries: readonly Library[]) {
      const before = librariesRead;
      yield* refreshSource(libraries);
      yield* Effect.promise(() =>
        expect.poll(() => librariesRead).toBeGreaterThan(before),
      );
    }),
    failLibraries: (on: boolean) => {
      failing = on;
    },
    gateLibraries: Effect.fnUntraced(function* () {
      gate = {
        waiting: yield* Deferred.make<void>(),
        release: yield* Deferred.make<void>(),
      };
      return gate;
    }),
  };
});
