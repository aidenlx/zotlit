import { Effect } from "effect";
import { expect, it } from "vitest";

import { createNanoEvents } from "@zotlit/shared/nanoevents";

import { MY_LIBRARY_SCOPE } from "@/services/library-scope/scope";
import type { ZoteroPrefEvents } from "@/services/zotero-pref/service";
import { layerRcRef } from "@/services/zotero-reads/connection";
import type { ZoteroReadsClient } from "@/services/zotero-reads/in-process";
import type { ZoteroReadsEvents } from "@/services/zotero-reads/service";
import {
  inProcessClient,
  memoryOpener,
  seedWorksSql,
} from "@/services/zotero-reads/test-utils";

import { CitationReads } from "./reads";
import { SettingsStub } from "./test-harness";

function fixture(
  options: {
    opening?: Promise<void>;
    wrap?: (client: ZoteroReadsClient) => ZoteroReadsClient;
  } = {},
) {
  const changes = createNanoEvents<ZoteroReadsEvents>();
  const prefs = createNanoEvents<ZoteroPrefEvents>();
  const settings = new SettingsStub();
  let databasePath = "fixture";
  let key = "first";
  let fail = false;
  const opener = memoryOpener(() =>
    fail
      ? null
      : seedWorksSql([{ itemID: 1, key: "ITEMKEY1", citationKey: key }]),
  );
  const reads = new CitationReads({
    settings,
    source: { on: changes.on.bind(changes) },
    zoteroPref: {
      ready: Promise.resolve(),
      get databasePath() {
        return databasePath;
      },
      on: prefs.on.bind(prefs),
    },
    client: () =>
      Effect.andThen(
        Effect.promise(() => options.opening ?? Promise.resolve()),
        Effect.map(
          inProcessClient(layerRcRef(opener.open), { citationOnly: true }),
          options.wrap ?? ((client) => client),
        ),
      ),
  });
  return {
    reads,
    settings,
    path(next: string) {
      databasePath = next;
      prefs.emit("resolved-changed");
    },
    change(next: string) {
      key = next;
      changes.emit("changed");
    },
    fail() {
      fail = true;
      changes.emit("refresh-requested");
    },
    recover() {
      fail = false;
      changes.emit("refresh-requested");
    },
  };
}

const request = {
  citekeys: ["first", "second", "third"],
  indexedKeys: ["ITEMKEY1"],
};

it("keeps a source change during startup and answers from the latest source", async () => {
  const opening = Promise.withResolvers<void>();
  const source = fixture({ opening: opening.promise });
  await using reads = source.reads;
  source.change("second");
  opening.resolve();
  const answer = await reads.readLookup(request, MY_LIBRARY_SCOPE);
  expect(answer.resolve("first")).toEqual({ kind: "missing" });
  expect(answer.citekeyOf("ITEMKEY1")).toBe("second");
});

it("retries an obsolete reply after a source change", async () => {
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let hold = true;
  const source = fixture({
    wrap: (client) => ({
      ...client,
      CitationLookup: ((payload, options) =>
        client.CitationLookup(payload, options).pipe(
          Effect.tap(() => {
            if (!hold) return Effect.void;
            hold = false;
            entered.resolve();
            return Effect.promise(() => release.promise);
          }),
        )) as typeof client.CitationLookup,
    }),
  });
  await using reads = source.reads;
  const oldRead = reads.readLookup(request, MY_LIBRARY_SCOPE);
  await entered.promise;
  source.change("second");
  const fresh = await reads.readLookup(request, MY_LIBRARY_SCOPE);
  expect(fresh.citekeyOf("ITEMKEY1")).toBe("second");
  release.resolve();
  const retried = await oldRead;
  expect(retried.revision).toBe(fresh.revision);
  expect(retried.citekeyOf("ITEMKEY1")).toBe("second");
});

it("refreshes on demand when source notifications never reach the worker", async () => {
  const source = fixture({
    wrap: (client) => ({
      ...client,
      CitationRefresh: (() =>
        Effect.succeed(-1)) as typeof client.CitationRefresh,
    }),
  });
  await using reads = source.reads;
  const first = await reads.readLookup(request, MY_LIBRARY_SCOPE);
  source.change("second");
  expect(
    (await reads.readLookup(request, MY_LIBRARY_SCOPE)).citekeyOf("ITEMKEY1"),
  ).toBe("second");
  expect(first.citekeyOf("ITEMKEY1")).toBe("first");
});

it("accepts a reply that already covers the latest generation without another lookup", async () => {
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const notified = Promise.withResolvers<void>();
  let expectedGeneration = -1;
  let calls = 0;
  const source = fixture({
    wrap: (client) => ({
      ...client,
      CitationRefresh: ((payload, options) =>
        client.CitationRefresh(payload, options).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              if (payload.generation === expectedGeneration) notified.resolve();
            }),
          ),
        )) as typeof client.CitationRefresh,
      CitationLookup: ((payload, options) =>
        Effect.gen(function* () {
          calls += 1;
          entered.resolve();
          yield* Effect.promise(() => release.promise);
          return yield* client.CitationLookup(payload, options);
        })) as typeof client.CitationLookup,
    }),
  });
  await using reads = source.reads;
  const waiting = reads.readLookup(request, MY_LIBRARY_SCOPE);
  await entered.promise;
  expectedGeneration = reads.generation + 1;
  source.change("second");
  await notified.promise;
  release.resolve();
  expect((await waiting).citekeyOf("ITEMKEY1")).toBe("second");
  expect(calls).toBe(1);
});

it("retries an obsolete failure only after a newer source signal", async () => {
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const source = fixture({
    wrap: (client) => ({
      ...client,
      CitationLookup: ((payload, options) =>
        client.CitationLookup(payload, options).pipe(
          Effect.tapError(() => {
            entered.resolve();
            return Effect.promise(() => release.promise);
          }),
        )) as typeof client.CitationLookup,
    }),
  });
  await using reads = source.reads;
  await reads.readLookup(request, MY_LIBRARY_SCOPE);
  source.fail();
  const waiting = reads.readLookup(request, MY_LIBRARY_SCOPE);
  await entered.promise;
  source.recover();
  source.change("second");
  release.resolve();
  expect((await waiting).citekeyOf("ITEMKEY1")).toBe("second");
});

it("ends a cancelled call and unloads active calls and signal subscriptions", async () => {
  const entered = Promise.withResolvers<void>();
  let ended = 0;
  const source = fixture({
    wrap: (client) => ({
      ...client,
      CitationLookup: (() =>
        Effect.sync(() => entered.resolve()).pipe(
          Effect.andThen(Effect.never),
          Effect.onInterrupt(() =>
            Effect.sync(() => {
              ended += 1;
            }),
          ),
        )) as typeof client.CitationLookup,
    }),
  });
  const reads = source.reads;
  await reads.ready;
  const abort = new AbortController();
  const cancelled = reads.readLookup(request, MY_LIBRARY_SCOPE, {
    signal: abort.signal,
  });
  const rejection = expect(cancelled).rejects.toBeDefined();
  await entered.promise;
  abort.abort();
  await rejection;
  expect(ended).toBe(1);
  const pending = reads.readLookup(request, MY_LIBRARY_SCOPE);
  const stopped = expect(pending).rejects.toBeDefined();
  await reads[Symbol.asyncDispose]();
  await stopped;
  expect(ended).toBe(2);
  const generation = reads.generation;
  source.change("second");
  source.path("new-source");
  source.settings.update({ "zotero.read-mode": "copy" });
  expect(reads.generation).toBe(generation);
  await expect(
    reads.readLookup(request, MY_LIBRARY_SCOPE),
  ).rejects.toBeDefined();
});

it("advances the source generation for path, Read Mode and log-level changes", async () => {
  const calls: Parameters<ZoteroReadsClient["CitationLookup"]>[0][] = [];
  const source = fixture({
    wrap: (client) => ({
      ...client,
      CitationLookup: ((payload, options) => {
        calls.push(payload);
        return client.CitationLookup(payload, options);
      }) as typeof client.CitationLookup,
    }),
  });
  await using reads = source.reads;
  await reads.ready;
  const generation = reads.generation;
  source.path("new-source");
  source.settings.update({ "zotero.read-mode": "copy" });
  source.settings.update({ "log.level": "debug" });
  expect(reads.generation).toBe(generation + 3);
  await reads.refreshLookup(MY_LIBRARY_SCOPE);
  expect(calls.at(-1)).toMatchObject({
    generation: generation + 3,
    config: {
      databasePath: "new-source",
      readMode: "copy",
      logLevel: "debug",
      autoRefresh: false,
    },
  });
  source.settings.update({ "log.level": "debug" });
  expect(reads.generation).toBe(generation + 3);
});
