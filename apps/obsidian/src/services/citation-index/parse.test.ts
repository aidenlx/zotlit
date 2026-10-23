import { expect, it } from "vitest";

import { inProcessParseClient } from "@/services/citation-parse/in-process";
import { RecoveringParseClient } from "@/services/citation-parse/recovering-client";

import { createCitationIndexHarness, link, MemoryStore } from "./test-harness";

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
  using client = new RecoveringParseClient(() => {
    connections++;
    return {
      died: connections === 1 ? failed.promise : new Promise<void>(() => {}),
      async parse(request, signal) {
        if (connections === 1) {
          started.resolve();
          await failed.promise;
          throw new Error("worker crashed");
        }
        return inProcessParseClient.parse(request, signal);
      },
      [Symbol.dispose]() {},
    };
  });
  client.start();
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
