import { it } from "@effect/vitest";
import { Effect, Layer, Stream } from "effect";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect } from "vitest";

import { readsFixture } from "@/services/zotero-reads/__fixtures__";
import { layerRcRef } from "@/services/zotero-reads/connection";
import { ZoteroReads } from "@/services/zotero-reads/service";
import {
  inProcessClient,
  memoryOpener,
} from "@/services/zotero-reads/test-utils";

import { makeWelcomeHost, waitFor } from "./__fixtures__";
import {
  connectionLifecycleAtom,
  readConnectionStatus,
  readConnectionSync,
} from "./connection";

/** One regular item per row in `libraryItems`, as [libraryID, count] pairs. */
function itemsSql(libraryItems: [libraryID: number, count: number][]): string {
  let itemID = 0;
  return libraryItems
    .map(([libraryID, count]) => {
      const library =
        libraryID === 1
          ? `insert into libraries (libraryID, type) values (1, 'user');`
          : `insert into libraries (libraryID, type) values (${libraryID}, 'group');
             insert into groups (groupID, libraryID, name) values (${libraryID * 100}, ${libraryID}, 'Group ${libraryID}');`;
      const items = Array.from({ length: count }, () => {
        itemID += 1;
        return `insert into items (itemID, itemTypeID, libraryID, key) values (${itemID}, 1, ${libraryID}, 'ITEM${String(itemID).padStart(4, "0")}');`;
      });
      return [library, ...items].join("\n");
    })
    .join("\n");
}

const ONE_LIBRARY = `insert into itemTypes (itemTypeID, typeName) values (1, 'book');
${itemsSql([[1, 2]])}`;

const setup = Effect.fnUntraced(function* (
  seeds: (string | null)[],
  dataDir = "/opt/zotero-data",
) {
  const { open } = memoryOpener((n) => seeds[n - 1] ?? null);
  const { service } = yield* readsFixture(inProcessClient(layerRcRef(open)));
  yield* Stream.runHead(
    Stream.filter(service.changes, (state) => state.state !== "loading"),
  );
  const host = yield* Effect.acquireRelease(
    Effect.promise(() =>
      makeWelcomeHost({
        dataDir,
        services: Layer.succeed(ZoteroReads, service),
      }),
    ),
    (host) => Effect.promise(() => host.close()),
  );
  return {
    reads: service,
    read: Effect.provideContext(readConnectionStatus, host.context),
    sync: Effect.provideContext(readConnectionSync, host.context),
    host,
  };
});

describe("readConnectionStatus", () => {
  it.effect("database that cannot open → missing", () =>
    Effect.gen(function* () {
      const deps = yield* setup([null]);

      expect(yield* deps.read).toEqual({ status: "missing" });
    }),
  );

  it.effect("ready but last refresh failed → missing", () =>
    Effect.gen(function* () {
      const deps = yield* setup([ONE_LIBRARY, null]);
      yield* deps.read;

      yield* Effect.ignore(deps.reads.refresh);
      yield* Stream.runHead(
        Stream.filter(deps.reads.changes, (state) => state.error !== null),
      );

      expect(yield* deps.read).toEqual({ status: "missing" });
    }),
  );

  it.effect("ready → connected with the item count of the one library", () =>
    Effect.gen(function* () {
      const deps = yield* setup([ONE_LIBRARY]);

      expect(yield* deps.read).toEqual({
        status: "connected",
        path: "/opt/zotero-data",
        itemCount: 2,
      });
    }),
  );

  it.effect(
    "totals every library the database holds, whatever the library scope is",
    () =>
      Effect.gen(function* () {
        const deps = yield* setup([
          `insert into itemTypes (itemTypeID, typeName) values (1, 'book');
       ${itemsSql([
         [1, 4],
         [2, 2],
         [3, 1],
       ])}`,
        ]);

        expect(yield* deps.read).toMatchObject({
          status: "connected",
          itemCount: 7,
        });
      }),
  );

  it.effect("abbreviates a data dir under the home directory to ~", () =>
    Effect.gen(function* () {
      const deps = yield* setup([ONE_LIBRARY], join(homedir(), "Zotero"));

      expect(yield* deps.read).toMatchObject({
        path: "~/Zotero",
      });
    }),
  );
});

describe("readConnectionSync", () => {
  it.effect("answers nothing until a count is held, then the held count", () =>
    Effect.gen(function* () {
      const deps = yield* setup([ONE_LIBRARY]);

      expect(yield* deps.sync).toBeNull();
      yield* deps.read;

      expect(yield* deps.sync).toEqual({
        status: "connected",
        path: "/opt/zotero-data",
        itemCount: 2,
      });
    }),
  );

  it.effect(
    "keeps the previous count after a refresh until the fresh readout lands",
    () =>
      Effect.gen(function* () {
        const deps = yield* setup([
          ONE_LIBRARY,
          `insert into itemTypes (itemTypeID, typeName) values (1, 'book');
       ${itemsSql([[1, 5]])}`,
        ]);
        yield* deps.read;

        yield* deps.reads.refresh;
        // Invalidation is delivered before the revision changes in the view registry.
        yield* Effect.promise(() =>
          waitFor(() =>
            expect(
              deps.host.registry.get(connectionLifecycleAtom).revision,
            ).toBeGreaterThan(0),
          ),
        );

        expect(yield* deps.sync).toMatchObject({ itemCount: 2 });
        expect(yield* deps.read).toMatchObject({ itemCount: 5 });
        expect(yield* deps.sync).toMatchObject({ itemCount: 5 });
      }),
  );

  it.effect("answers missing when the database cannot open", () =>
    Effect.gen(function* () {
      const deps = yield* setup([null]);
      yield* deps.read;

      expect(yield* deps.sync).toEqual({ status: "missing" });
    }),
  );
});
