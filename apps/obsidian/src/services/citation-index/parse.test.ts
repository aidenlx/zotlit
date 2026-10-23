import { TestClock } from "effect/testing";
import { expect, it } from "vitest";

import { Effect, Layer, Scope } from "@/lib/effect";
import { openScope } from "@/lib/effect-scope";
import { ParseWorkerDied } from "@/services/citation-parse/client";
import { inProcessParseClient } from "@/services/citation-parse/in-process";
import { makeRecoveringParseClient } from "@/services/citation-parse/recovering-client";
import type { ParseConnection } from "@/services/citation-parse/recovering-client";

import {
  createCitationIndexHarness,
  KEY_A,
  link,
  MemoryStore,
} from "./test-harness";

it("aborts a document wait while another consumer keeps the shared parse (#1691)", async () => {
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let parseSignal: AbortSignal | undefined;
  await using harness = await createCitationIndexHarness(
    { "draft.md": "@doe2024" },
    {
      notes: false,
      parseClient: {
        async parse(request, signal) {
          parseSignal = signal;
          entered.resolve();
          await release.promise;
          return inProcessParseClient.parse(request, signal);
        },
      },
    },
  );
  const stop = new AbortController();
  const cancelled = harness.index.getDocumentCitationSet(harness.draft, {
    signal: stop.signal,
  });
  const rejected = expect(cancelled).rejects.toMatchObject({
    name: "AbortError",
  });
  await entered.promise;
  const remaining = harness.index.getDocumentCitationSet(harness.draft);
  stop.abort();
  try {
    await rejected;
    expect(parseSignal?.aborted).toBe(false);
  } finally {
    release.resolve();
  }
  expect((await remaining).occurrences.map(({ raw }) => raw)).toEqual([
    "doe2024",
  ]);
});

it.each(["changed event", "document read"])(
  "serves the retained record to readers awaiting a failed replacement from a %s (#1691)",
  async (source) => {
    const store = new MemoryStore();
    await using seed = await createCitationIndexHarness(
      { "draft.md": "@doe2024" },
      { store, notes: false },
    );
    await seed.index.getDocumentCitationSet(seed.draft);
    const saved = structuredClone(store.records.get("draft.md"));
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let parseSignal: AbortSignal | undefined;
    await using harness = await createCitationIndexHarness(
      { "draft.md": "@doe2024" },
      {
        store,
        notes: false,
        parseClient: {
          async parse(_request, signal) {
            parseSignal = signal;
            entered.resolve();
            await release.promise;
            throw new Error("Replacement parse failed");
          },
        },
      },
    );
    if (source === "changed event")
      harness.metadataCache.change(harness.draft, "@replacement");
    else harness.vault.write(harness.draft, "@replacement");
    const stop = new AbortController();
    const cancelled = expect(
      harness.index.getDocumentCitationSet(harness.draft, {
        signal: stop.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    const retained = expect(
      harness.index.getDocumentCitationSet(harness.draft),
    ).resolves.toMatchObject({ occurrences: [{ raw: "doe2024" }] });
    await entered.promise;
    stop.abort();
    await cancelled;
    expect(parseSignal?.aborted).toBe(false);
    release.resolve();
    await retained;
    expect(store.records.get("draft.md")).toEqual(saved);
  },
);

it.each(["before", "during"])(
  "reports degraded coverage when an edit fails %s backfill, while saved citations remain available (#1691)",
  async (timing) => {
    const store = new MemoryStore();
    await using seed = await createCitationIndexHarness(
      { "draft.md": "@doe2024" },
      { store, notes: false },
    );
    await seed.index.getDocumentCitationSet(seed.draft);
    const saved = structuredClone(store.records.get("draft.md"));
    const release = Promise.withResolvers<void>();
    await using harness = await createCitationIndexHarness(
      { "draft.md": "@doe2024", "neighbour.md": "@roe2025" },
      {
        store,
        notes: false,
        parseClient: {
          async parse(request, signal) {
            if (request.path === "draft.md") {
              await release.promise;
              throw new Error("Edited note failed to parse");
            }
            return inProcessParseClient.parse(request, signal);
          },
        },
      },
    );
    harness.metadataCache.change(harness.draft, "@replacement");
    const reader = harness.index.getDocumentCitationSet(harness.draft);
    if (timing === "during") harness.workspace.layoutReady();
    release.resolve();
    await reader;
    if (timing === "before") harness.workspace.layoutReady();
    await harness.index.whenIndexed();
    expect(await harness.index.getCitedBy(KEY_A)).toMatchObject({
      coverage: "degraded",
      groups: [{ path: "draft.md" }],
    });
    expect(harness.index.citationKeys()).toEqual(["doe2024", "roe2025"]);
    expect(store.records.get("draft.md")).toEqual(saved);
  },
);

it("excludes wikilinks inside comments even when Obsidian lists them (#1691)", async () => {
  await using harness = await createCitationIndexHarness(
    { "draft.md": "%% [[Doe 2024]] %% [[Roe 2025]]" },
    { settings: { "citation.wikilink-citations": true } },
  );
  harness.metadataCache.fileCache.set("draft.md", {
    links: [link("Doe 2024", 3), link("Roe 2025", 18)],
  });
  const document = await harness.index.getDocumentCitationSet(harness.draft);
  expect(document.occurrences.map(({ raw }) => raw)).toEqual(["Roe 2025"]);
});

it("drops a superseded parse after a newer edit has been applied (#1691)", async () => {
  const release = Promise.withResolvers<void>();
  const started = Promise.withResolvers<void>();
  await using harness = await createCitationIndexHarness(
    { "draft.md": "@doe2024" },
    {
      notes: false,
      parseClient: {
        async parse(request, signal) {
          if (request.text === "@doe2024") {
            started.resolve();
            await release.promise;
          }
          return inProcessParseClient.parse(request, signal);
        },
      },
    },
  );
  const publications: string[][] = [];
  harness.index.on("changed", () =>
    publications.push(harness.index.citationKeys()),
  );
  harness.workspace.layoutReady();
  await started.promise;
  const changed = new Promise<void>((resolve) =>
    harness.index.once("changed", () => resolve()),
  );
  harness.metadataCache.change(harness.draft, "@roe2025");
  await changed;
  release.resolve();
  await harness.index.whenIndexed();
  expect(publications).toEqual([["roe2025"]]);
  expect(harness.index.citationKeys()).toEqual(["roe2025"]);
  expect(
    harness.store.records.get("draft.md")?.citekeys.map(({ raw }) => raw),
  ).toEqual(["roe2025"]);
});

it("serves an older scanner revision until backfill replaces it (#1691)", async () => {
  const store = new MemoryStore();
  await using seed = await createCitationIndexHarness(
    { "draft.md": "@doe2024" },
    { store, notes: false },
  );
  await seed.index.getDocumentCitationSet(seed.draft);
  const record = store.records.get("draft.md")!;
  record.scannerRevision = 0;
  record.citekeys[0]!.raw = "roe2025";
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  await using harness = await createCitationIndexHarness(
    { "draft.md": "@doe2024" },
    {
      store,
      notes: false,
      parseClient: {
        async parse(request, signal) {
          entered.resolve();
          await release.promise;
          return inProcessParseClient.parse(request, signal);
        },
      },
    },
  );
  expect(
    (await harness.index.getDocumentCitationSet(harness.draft)).occurrences.map(
      ({ raw }) => raw,
    ),
  ).toEqual(["roe2025"]);
  harness.workspace.layoutReady();
  // A completed pass also releases the wait, so a skipped stale record fails below.
  await Promise.race([entered.promise, harness.index.whenIndexed()]);
  expect(harness.index.citationKeys()).toEqual(["roe2025"]);
  release.resolve();
  await harness.index.whenIndexed();
  expect(harness.index.citationKeys()).toEqual(["doe2024"]);
  expect(store.records.get("draft.md")?.scannerRevision).toBe(1);
});

it("requeues failed parses and keeps persisted citations during worker recovery (#1691)", async () => {
  const store = new MemoryStore();
  await using seed = await createCitationIndexHarness(
    { "draft.md": "@doe2024" },
    { store, notes: false },
  );
  await seed.index.getDocumentCitationSet(seed.draft);
  store.records.get("draft.md")!.scannerRevision = 0;
  const failed = Promise.withResolvers<void>();
  const started = Promise.withResolvers<void>();
  let connections = 0;
  await using recovery = await recoveringClient(() => {
    connections++;
    return {
      died: connections === 1 ? failed.promise : new Promise<void>(() => {}),
      async parse(request, signal) {
        if (connections === 1) {
          started.resolve();
          await failed.promise;
          throw new ParseWorkerDied("worker crashed");
        }
        return inProcessParseClient.parse(request, signal);
      },
      [Symbol.dispose]() {},
    };
  });
  const { client } = recovery;
  await using harness = await createCitationIndexHarness(
    { "draft.md": "@doe2024", "new.md": "@roe2025" },
    { store, notes: false, parseClient: client },
  );
  harness.workspace.layoutReady();
  await started.promise;
  expect(harness.index.citationKeys()).toEqual(["doe2024"]);
  failed.resolve();
  expect(
    (await harness.index.getDocumentCitationSet(harness.draft)).occurrences.map(
      ({ raw }) => raw,
    ),
  ).toEqual(["doe2024"]);
  await recovery.advance(99);
  expect(connections).toBe(1);
  await recovery.advance(1);
  await harness.index.whenIndexed();
  expect(connections).toBe(2);
  expect([...harness.index.citationsByPath(["citekey"]).keys()]).toEqual([
    "draft.md",
    "new.md",
  ]);
  expect(store.records.get("draft.md")?.scannerRevision).toBe(1);
});

it("bounds backfill at four in-flight notes and prunes absent paths (#1691)", async () => {
  const store = new MemoryStore();
  await using seed = await createCitationIndexHarness(
    { "deleted.md": "@doe2024" },
    { store, notes: false },
  );
  seed.workspace.layoutReady();
  await seed.index.whenIndexed();
  const release = Promise.withResolvers<void>();
  let active = 0;
  let peak = 0;
  await using harness = await createCitationIndexHarness(
    Object.fromEntries(
      Array.from({ length: 9 }, (_, i) => [`note-${i}.md`, "@roe2025"]),
    ),
    {
      store,
      notes: false,
      parseClient: {
        async parse(request, signal) {
          active++;
          peak = Math.max(peak, active);
          try {
            await release.promise;
            return await inProcessParseClient.parse(request, signal);
          } finally {
            active--;
          }
        },
      },
    },
  );
  harness.workspace.layoutReady();
  try {
    await expect.poll(() => active).toBe(4);
    expect(harness.vault.reads).toHaveLength(4);
  } finally {
    release.resolve();
  }
  await harness.index.whenIndexed();
  expect(peak).toBe(4);
  expect(harness.index.citationsByPath(["citekey"]).size).toBe(9);
  expect(store.records.has("deleted.md")).toBe(false);
});

it("moves an in-flight scan on rename and deletes it without parsing again (#1691)", async () => {
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let parses = 0;
  await using harness = await createCitationIndexHarness(
    {
      "draft.md":
        "@doe2024 [[Doe 2024]] [](zotero://open/library/items/ABCD2345?annotation=EFGH6789) [](zotero://open/library/items/ABCD2345)",
    },
    {
      notes: false,
      parseClient: {
        async parse(request, signal) {
          parses++;
          entered.resolve();
          await release.promise;
          return inProcessParseClient.parse(request, signal);
        },
      },
    },
  );
  harness.workspace.layoutReady();
  await entered.promise;
  harness.vault.rename(harness.draft, "renamed.md");
  release.resolve();
  await harness.index.whenIndexed();
  expect(parses).toBe(1);
  expect(harness.store.records.get("renamed.md")).toMatchObject({
    citekeys: [{ raw: "doe2024" }],
    wikilinks: [{ raw: "Doe 2024" }],
    annotations: [{ form: "citation", indexedKey: "EFGH6789" }],
    malformedAnnotationCitations: [
      { destination: "zotero://open/library/items/ABCD2345" },
    ],
  });
  expect(harness.store.records.has("draft.md")).toBe(false);
  harness.vault.deleteFile(harness.draft);
  expect(harness.index.citationsByPath(["citekey", "wikilink"]).size).toBe(0);
  expect(harness.store.records.size).toBe(0);
  expect(parses).toBe(1);
});

it("restores saved citations while a startup edit is still parsing (#1691)", async () => {
  const store = new MemoryStore();
  await using seed = await createCitationIndexHarness(
    { "draft.md": "@doe2024" },
    { store, notes: false },
  );
  await seed.index.getDocumentCitationSet(seed.draft);
  const loaded = Promise.withResolvers<void>();
  const restore = Promise.withResolvers<void>();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  await using harness = await createCitationIndexHarness(
    { "draft.md": "@doe2024" },
    {
      notes: false,
      awaitReady: false,
      openStore: async () => ({
        async load() {
          const records = await store.load();
          loaded.resolve();
          await restore.promise;
          return records;
        },
        put: (record) => store.put(record),
        drop: (path) => store.drop(path),
        clear: () => store.clear(),
        [Symbol.dispose]() {},
      }),
      parseClient: {
        async parse(request, signal) {
          entered.resolve();
          await release.promise;
          return inProcessParseClient.parse(request, signal);
        },
      },
    },
  );
  await loaded.promise;
  harness.metadataCache.change(harness.draft, "@roe2025");
  await entered.promise;
  restore.resolve();
  await harness.index.ready;
  try {
    expect(
      harness.index
        .citationsByPath(["citekey"])
        .get("draft.md")
        ?.map(({ raw }) => raw),
    ).toEqual(["doe2024"]);
  } finally {
    release.resolve();
  }
  expect(
    (await harness.index.getDocumentCitationSet(harness.draft)).occurrences.map(
      ({ raw }) => raw,
    ),
  ).toEqual(["roe2025"]);
});

it("gives up a throwing note and indexes its neighbours without restarting (#1691)", async () => {
  const store = new MemoryStore();
  await using seed = await createCitationIndexHarness(
    { "draft.md": "@doe2024" },
    { store, notes: false },
  );
  await seed.index.getDocumentCitationSet(seed.draft);
  const saved = structuredClone(store.records.get("draft.md"));
  let connections = 0;
  let attempts = 0;
  await using recovery = await recoveringClient(() => {
    connections++;
    return {
      died: new Promise<void>(() => {}),
      async parse(request, signal) {
        if (request.path === "draft.md") {
          attempts++;
          throw new Error("Scanner failed for this note");
        }
        return inProcessParseClient.parse(request, signal);
      },
      [Symbol.dispose]() {},
    };
  });
  const { client } = recovery;
  await using harness = await createCitationIndexHarness(
    { "draft.md": "@poison", "neighbour.md": "@roe2025" },
    { store, notes: false, parseClient: client },
  );
  harness.workspace.layoutReady();
  await harness.index.whenIndexed();
  expect(harness.index.citationKeys()).toEqual(["doe2024", "roe2025"]);
  expect(store.records.get("draft.md")).toEqual(saved);
  expect(
    store.records.get("neighbour.md")?.citekeys.map(({ raw }) => raw),
  ).toEqual(["roe2025"]);
  expect(attempts).toBe(1);
  expect(connections).toBe(1);
});

async function recoveringClient(connect: () => ParseConnection) {
  const { scope, close } = openScope();
  const context = await Effect.runPromise(
    Layer.buildWithScope(TestClock.layer(), scope),
  );
  const client = await Effect.runPromiseWith(context)(
    makeRecoveringParseClient(connect).pipe(Scope.provide(scope)),
  );
  client.start();
  return {
    client,
    advance: (millis: number) =>
      Effect.runPromiseWith(context)(TestClock.adjust(millis)),
    async [Symbol.asyncDispose]() {
      await close();
    },
  };
}

it.each([0, 10_000])(
  "replaces a stalled connection and replays neighbours queued %i ms later while retaining the failed note (#1691)",
  async (arrival) => {
    const store = new MemoryStore();
    await using seed = await createCitationIndexHarness(
      { "draft.md": "@doe2024" },
      { store, notes: false },
    );
    await seed.index.getDocumentCitationSet(seed.draft);
    const saved = structuredClone(store.records.get("draft.md"));
    const entered = Promise.withResolvers<void>();
    const queued = Promise.withResolvers<void>();
    let connections = 0;
    let attempts = 0;
    let terminations = 0;
    await using recovery = await recoveringClient(() => {
      connections++;
      const died = Promise.withResolvers<void>();
      let blocked = false;
      let stopped = false;
      return {
        died: died.promise,
        async parse(request, signal) {
          if (request.text === "@poison") {
            attempts++;
            blocked = true;
            entered.resolve();
          }
          if (blocked) {
            if (request.path === "neighbour.md") queued.resolve();
            await died.promise;
            throw new ParseWorkerDied("Blocked worker terminated");
          }
          return inProcessParseClient.parse(request, signal);
        },
        [Symbol.dispose]() {
          if (stopped) return;
          stopped = true;
          terminations++;
          died.resolve();
        },
      };
    });
    await using harness = await createCitationIndexHarness(
      { "draft.md": "@poison", "neighbour.md": "@roe2025" },
      { store, notes: false, parseClient: recovery.client },
    );
    const readNeighbour = harness.vault.hold("neighbour.md");
    harness.workspace.layoutReady();
    await entered.promise;
    await recovery.advance(arrival);
    readNeighbour();
    await queued.promise;
    expect(harness.index.citationKeys()).toEqual(["doe2024"]);
    await recovery.advance(15_000 - arrival);
    expect(terminations).toBe(1);
    await recovery.advance(100);
    await harness.index.whenIndexed();
    expect(connections).toBe(2);
    expect(attempts).toBe(1);
    expect(store.records.get("draft.md")).toEqual(saved);
    expect(harness.index.citationKeys()).toEqual(["doe2024", "roe2025"]);
    harness.metadataCache.change(harness.draft, "@recovered");
    expect(
      (
        await harness.index.getDocumentCitationSet(harness.draft)
      ).occurrences.map(({ raw }) => raw),
    ).toEqual(["recovered"]);
  },
);

it("settles backfill when the parse worker cannot start (#1691)", async () => {
  const entered = Promise.withResolvers<void>();
  await using recovery = await recoveringClient(() => {
    entered.resolve();
    throw new Error("Worker could not start");
  });
  await using harness = await createCitationIndexHarness(
    { "draft.md": "@doe2024" },
    { notes: false, parseClient: recovery.client },
  );
  harness.workspace.layoutReady();
  await entered.promise;
  let indexed = false;
  const settled = harness.index.whenIndexed().then(() => {
    indexed = true;
  });
  await recovery.advance(15_000);
  await expect.poll(() => indexed).toBe(true);
  await settled;
  expect(await harness.index.getCitedBy(KEY_A)).toMatchObject({
    coverage: "degraded",
    groups: [],
  });
});

it("abandons a note after three worker deaths so backfill can settle (#1691)", async () => {
  const store = new MemoryStore();
  await using seed = await createCitationIndexHarness(
    { "draft.md": "@doe2024" },
    { store, notes: false },
  );
  await seed.index.getDocumentCitationSet(seed.draft);
  const saved = structuredClone(store.records.get("draft.md"));
  const attempts = Array.from({ length: 3 }, () =>
    Promise.withResolvers<void>(),
  );
  let count = 0;
  await using recovery = await recoveringClient(() => {
    const died = Promise.withResolvers<void>();
    return {
      died: died.promise,
      async parse(request, signal) {
        if (request.path === "draft.md") {
          attempts[count++]?.resolve();
          died.resolve();
          throw new ParseWorkerDied("This note crashed the worker");
        }
        return inProcessParseClient.parse(request, signal);
      },
      [Symbol.dispose]() {},
    };
  });
  await using harness = await createCitationIndexHarness(
    { "draft.md": "@poison", "neighbour.md": "@roe2025" },
    { store, notes: false, parseClient: recovery.client },
  );
  harness.workspace.layoutReady();
  await attempts[0]!.promise;
  await recovery.advance(100);
  await attempts[1]!.promise;
  await recovery.advance(200);
  await attempts[2]!.promise;
  await harness.index.whenIndexed();
  expect(count).toBe(3);
  expect(store.records.get("draft.md")).toEqual(saved);
  expect(harness.index.citationKeys()).toEqual(["doe2024", "roe2025"]);
});
