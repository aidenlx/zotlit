import { Effect, Scope, Stream } from "effect";
import { expect, it } from "vitest";

import { createClient } from "@zotlit/db/client/node";
import { createFixtureSchema } from "@zotlit/db/test-utils";
import { createNanoEvents } from "@zotlit/shared/nanoevents";

import { openScope } from "@/lib/effect-scope";
import { yieldToMain } from "@/lib/yield-to-main";
import type { ZoteroPrefEvents } from "@/services/zotero-pref/service";
import { layerRcRef } from "@/services/zotero-reads/connection";
import type { ZoteroReadsEvents } from "@/services/zotero-reads/service";
import { inProcessClient } from "@/services/zotero-reads/test-utils";

import { CitationReads } from "./reads";
import {
  createCitationIndexHarness,
  groupLibrary,
  LibraryScopeStub,
  SettingsStub,
} from "./test-harness";

it("keeps a source change during startup and reads the latest source", async () => {
  const starting = Promise.withResolvers<void>();
  const changes = createNanoEvents<ZoteroReadsEvents>();
  const settings = new SettingsStub();
  let path = "first";
  const prefs = createNanoEvents<ZoteroPrefEvents>();
  await using reads = new CitationReads({
    settings,
    source: { on: changes.on.bind(changes) },
    zoteroPref: {
      ready: Promise.resolve(),
      get databasePath() {
        return path;
      },
      on: prefs.on.bind(prefs),
    },
    client: () =>
      Effect.andThen(
        Effect.promise(() => starting.promise),
        inProcessClient(
          layerRcRef((config) => {
            const client = createClient(":memory:");
            createFixtureSchema(client.$client);
            client.$client.exec(
              `insert into libraries (libraryID, type, version, clientVersion) values (1, 'user', ${config?.databasePath === "second" ? 2 : 1}, 0)`,
            );
            return client;
          }),
        ),
      ),
  });
  path = "second";
  prefs.emit("resolved-changed");
  changes.emit("changed");
  starting.resolve();
  await reads.ready;
  const libraries = await Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(reads.snapshot, (snapshot) => snapshot.Libraries({})),
    ),
  );
  expect(libraries).toMatchObject([{ version: 2 }]);
});

it("publishes only the latest source after a held read, with local Library IDs reused", async () => {
  const oldReading = Promise.withResolvers<void>();
  const releaseOld = Promise.withResolvers<void>();
  const changes = createNanoEvents<ZoteroReadsEvents>();
  const prefs = createNanoEvents<ZoteroPrefEvents>();
  const settings = new SettingsStub();
  let path = "first";
  await using reads = new CitationReads({
    settings,
    source: { on: changes.on.bind(changes) },
    zoteroPref: {
      ready: Promise.resolve(),
      get databasePath() {
        return path;
      },
      on: prefs.on.bind(prefs),
    },
    client: () =>
      Effect.map(
        inProcessClient(
          layerRcRef((config) => {
            const second = config?.databasePath === "second";
            const client = createClient(":memory:");
            createFixtureSchema(client.$client);
            client.$client.exec(`
        insert into libraries (libraryID, type, version, clientVersion) values (1, 'group', 1, 0);
        insert into groups (groupID, libraryID, name) values (${second ? 12 : 7}, 1, 'Group');
        insert into itemTypes (itemTypeID, typeName) values (1, 'journalArticle');
        insert into fieldsCombined (fieldID, fieldName, custom) values (11, 'citationKey', 0);
        insert into items (itemID, itemTypeID, dateAdded, dateModified, libraryID, key)
          values (1, 1, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 1, '${second ? "NEWKEY12" : "OLDKEY77"}');
        insert into itemDataValues (valueID, value) values (1, 'shared');
        insert into itemData (itemID, fieldID, valueID) values (1, 11, 1);
      `);
            return client;
          }),
          { citationOnly: true },
        ),
        (client) => ({
          ...client,
          CitekeySnapshot: ((payload) =>
            client.CitekeySnapshot(payload).pipe(
              Stream.tap((rows) => {
                if (rows[0]?.key !== "OLDKEY77") return Effect.void;
                oldReading.resolve();
                return Effect.promise(() => releaseOld.promise);
              }),
            )) as typeof client.CitekeySnapshot,
        }),
      ),
  });
  const libraryScope = new LibraryScopeStub([groupLibrary({ libraryID: 1 })]);
  libraryScope.select([groupLibrary({ libraryID: 1 })]);
  await using harness = await createCitationIndexHarness(
    {},
    { reads, libraryScope, awaitReady: false },
  );
  await harness.index.ready;
  await oldReading.promise;
  path = "second";
  prefs.emit("resolved-changed");
  changes.emit("changed");
  await harness.index.whenResolved();
  expect(harness.index.resolveCitekey("shared")).toEqual({ kind: "missing" });
  expect(harness.index.citekeyOf("NEWKEY12g12")).toBe("shared");
  releaseOld.resolve();
  await yieldToMain();
  expect(harness.index.citekeyOf("OLDKEY77g7")).toBeNull();
  expect(harness.index.citekeyOf("NEWKEY12g12")).toBe("shared");
});

it("coalesces changes during refresh while an older Snapshot stays pinned", async () => {
  const entered = Promise.withResolvers<void>();
  const released = Promise.withResolvers<void>();
  const changes = createNanoEvents<ZoteroReadsEvents>();
  const prefs = createNanoEvents<ZoteroPrefEvents>();
  const settings = new SettingsStub({ "zotero.auto-refresh": false });
  let path = "1";
  let revision = 1;
  await using reads = new CitationReads({
    settings,
    source: { on: changes.on.bind(changes) },
    zoteroPref: {
      ready: Promise.resolve(),
      get databasePath() {
        return path;
      },
      on: prefs.on.bind(prefs),
    },
    client: () =>
      Effect.map(
        inProcessClient(
          layerRcRef(() => {
            const client = createClient(":memory:");
            createFixtureSchema(client.$client);
            client.$client.exec(
              `insert into libraries (libraryID, type, version, clientVersion) values (1, 'user', ${revision}, 0)`,
            );
            return client;
          }),
          { citationOnly: true },
        ),
        (client) => ({
          ...client,
          Configure: ((config, options) =>
            Effect.andThen(
              config.databasePath === "2"
                ? Effect.promise(() => {
                    entered.resolve();
                    return released.promise;
                  })
                : Effect.void,
              client.Configure(config, options),
            )) as typeof client.Configure,
        }),
      ),
  });
  const { scope, close } = openScope();
  await using _held = { [Symbol.asyncDispose]: close };
  const old = await Effect.runPromise(Scope.provide(reads.snapshot, scope));
  expect(await Effect.runPromise(old.Libraries({}))).toMatchObject([
    { version: 1 },
  ]);
  path = "2";
  revision = 2;
  prefs.emit("resolved-changed");
  await entered.promise;
  path = "3";
  revision = 3;
  prefs.emit("resolved-changed");
  changes.emit("changed");
  changes.emit("changed");
  released.resolve();
  const latest = () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.flatMap(reads.snapshot, (snapshot) => snapshot.Libraries({})),
      ),
    );
  expect(await latest()).toMatchObject([{ version: 3 }]);
  expect(await Effect.runPromise(old.Libraries({}))).toMatchObject([
    { version: 1 },
  ]);
  revision = 4;
  changes.emit("refresh-requested");
  expect(await latest()).toMatchObject([{ version: 4 }]);
});
