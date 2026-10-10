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
  let key = "first";
  let fail = false;
  const opener = memoryOpener(() =>
    fail
      ? null
      : seedWorksSql([{ itemID: 1, key: "ITEMKEY1", citationKey: key }]),
  );
  const reads = new CitationReads({
    settings: new SettingsStub(),
    source: { on: changes.on.bind(changes) },
    zoteroPref: {
      ready: Promise.resolve(),
      databasePath: "fixture",
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

it("coalesces refreshes, cancels only one waiting caller, and leaves a delivered answer intact", async () => {
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let hold = false;
  const source = fixture({
    wrap: (client) => ({
      ...client,
      Configure: ((payload, options) =>
        Effect.andThen(
          Effect.promise(async () => {
            if (!hold) return;
            hold = false;
            entered.resolve();
            await release.promise;
          }),
          client.Configure(payload, options),
        )) as typeof client.Configure,
    }),
  });
  await using reads = source.reads;
  const first = await reads.readLookup(request, MY_LIBRARY_SCOPE);
  hold = true;
  source.change("second");
  await entered.promise;
  const abort = new AbortController();
  const cancelled = reads.readLookup(request, MY_LIBRARY_SCOPE, {
    signal: abort.signal,
  });
  const rejected = expect(cancelled).rejects.toBeDefined();
  abort.abort();
  await rejected;
  source.change("third");
  const latest = reads.readLookup(request, MY_LIBRARY_SCOPE);
  release.resolve();
  expect((await latest).citekeyOf("ITEMKEY1")).toBe("third");
  expect(first.citekeyOf("ITEMKEY1")).toBe("first");
});

it("fails fresh reads after a failed refresh and recovers on the next successful refresh", async () => {
  const source = fixture();
  await using reads = source.reads;
  const first = await reads.readLookup(request, MY_LIBRARY_SCOPE);
  source.fail();
  await expect(
    reads.readLookup(request, MY_LIBRARY_SCOPE),
  ).rejects.toBeDefined();
  expect(first.citekeyOf("ITEMKEY1")).toBe("first");
  source.recover();
  expect(await reads.refreshLookup(MY_LIBRARY_SCOPE)).toBe(first.revision);
});
