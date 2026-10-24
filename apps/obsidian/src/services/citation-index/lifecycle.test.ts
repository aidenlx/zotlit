import { TestClock } from "effect/testing";
import { expect } from "vitest";

import { effectTestParse } from "@/lib/__fixtures__/parse-client";
import { Effect, Stream } from "@/lib/effect";
import { subscribe } from "@/lib/effect-stream";
import { it } from "@/lib/effect-vitest";
import { inProcessParseClient } from "@/services/citation-parse/in-process";

import type { CitationIndexState } from "./service";
import { CitationIndex } from "./service";
import { createCitationIndexHarness, KEY_A, MemoryStore } from "./test-harness";

it.effect(
  "disposes a store opened during runtime disposal exactly once (#1705)",
  () =>
    Effect.promise(async () => {
      const entered = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      let disposals = 0;
      const store = new MemoryStore();
      store[Symbol.dispose] = () => {
        disposals += 1;
      };
      await using h = await createCitationIndexHarness(
        {},
        {
          awaitReady: false,
          openStore: async () => {
            entered.resolve();
            await release.promise;
            return store;
          },
        },
      );
      const ready = h.ready.catch(() => {});
      await entered.promise;
      const closing = h.runtime.dispose();
      release.resolve();
      await closing;
      await ready;
      expect(disposals).toBe(1);
    }),
);

it.effect(
  "aborts a scan before closing its store during restoration (#1705)",
  () =>
    Effect.promise(async () => {
      const loading = Promise.withResolvers<void>();
      const restore = Promise.withResolvers<[]>();
      const parsing = Promise.withResolvers<void>();
      const reply = Promise.withResolvers<void>();
      const replied = Promise.withResolvers<void>();
      let parseSignal: AbortSignal | undefined;
      let abortedAtDisposal: boolean | undefined;
      let disposals = 0;
      const store = new MemoryStore();
      store.load = () => {
        loading.resolve();
        return restore.promise;
      };
      store[Symbol.dispose] = () => {
        disposals += 1;
        abortedAtDisposal = parseSignal?.aborted;
      };
      await using h = await createCitationIndexHarness(
        { "draft.md": "@doe2024" },
        {
          store,
          notes: false,
          awaitReady: false,
          parseClient: {
            parse: effectTestParse(async (request, signal) => {
              parseSignal = signal;
              const result = await Effect.runPromise(
                inProcessParseClient.parse(request),
                { signal },
              );
              parsing.resolve();
              await reply.promise;
              replied.resolve();
              return result;
            }),
          },
        },
      );
      const ready = h.ready.catch(() => {});
      await loading.promise;
      h.metadataCache.change(h.draft, "@roe2025");
      await parsing.promise;
      await h.runtime.dispose();
      reply.resolve();
      restore.resolve([]);
      await replied.promise;
      await ready;
      expect(disposals).toBe(1);
      expect(abortedAtDisposal).toBe(true);
      expect(store.writes).toEqual([]);
    }),
);

it.effect(
  "replays a completed failed backfill to a late subscriber (#1705)",
  () =>
    Effect.promise(async () => {
      await using h = await createCitationIndexHarness({
        "draft.md": "@doe2024",
      });
      h.vault.fail("draft.md");
      h.workspace.layoutReady();
      await h.index.whenIndexed();
      const delivered = Promise.withResolvers<CitationIndexState>();
      const off = subscribe(h.index.runtime, h.index.changes, (state) =>
        delivered.resolve(state),
      );
      expect(await delivered.promise).toMatchObject({
        backfilled: true,
        coverage: "degraded",
      });
      off();
    }),
);

it.effect(
  "restores scans and settings before acquisition, with backfill still pending (#1705)",
  () =>
    Effect.promise(async () => {
      const store = new MemoryStore();
      await using seed = await createCitationIndexHarness(
        { "draft.md": "@doe2024" },
        { store, notes: false },
      );
      await seed.index.getFileScan(seed.draft);
      const entered = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      await using h = await createCitationIndexHarness(
        { "draft.md": "@doe2024" },
        {
          notes: false,
          awaitReady: false,
          settings: {
            "citation.pandoc-citations": false,
            "citation.annotation-citations": false,
          },
          openStore: async () => {
            entered.resolve();
            await release.promise;
            return store;
          },
        },
      );
      await entered.promise;
      let acquired = false;
      const ready = h.ready.then(() => {
        acquired = true;
      });
      expect(acquired).toBe(false);
      release.resolve();
      await ready;
      expect(h.index.citationKeys()).toEqual(["doe2024"]);
      expect(h.index.syntaxes()).toEqual({
        citekey: "excluded",
        wikilink: "excluded",
        annotation: "excluded",
      });
      expect(h.index.current.backfilled).toBe(false);
      expect(h.vault.reads).toEqual([]);
    }),
);

it.effect(
  "attaches immediately and keeps throwing state and event subscribers through consecutive changes (#1705)",
  () =>
    Effect.promise(async () => {
      await using h = await createCitationIndexHarness({
        "draft.md": "@doe2024",
      });
      const states: string[] = [];
      const memberships: string[] = [];
      let initial = true;
      const offState = subscribe(h.index.runtime, h.index.changes, (state) => {
        if (initial) {
          initial = false;
          return;
        }
        states.push(state.syntaxes.citekey);
        throw new Error("state listener failed");
      });
      const offEvent = subscribe(
        h.index.runtime,
        h.index["membership-changed"],
        () => {
          memberships.push(h.index.syntaxes().citekey);
          throw new Error("event listener failed");
        },
      );
      h.settings.update({ "citation.pandoc-citations": false });
      h.settings.update({ "citation.pandoc-citations": true });
      await expect.poll(() => states).toEqual(["excluded", "included"]);
      await expect.poll(() => memberships.length).toBe(2);
      offState();
      offEvent();
      h.settings.update({ "citation.pandoc-citations": false });
      expect(h.index.syntaxes().citekey).toBe("excluded");
      expect(states).toHaveLength(2);
      expect(memberships).toHaveLength(2);
    }),
);

it.effect("continues host event intake after a failed handler (#1705)", () =>
  Effect.promise(async () => {
    await using h = await createCitationIndexHarness({
      "draft.md": "@doe2024",
    });
    let fail = true;
    Object.defineProperty(h.draft, "extension", {
      get() {
        if (fail) {
          fail = false;
          throw new Error("Host metadata failed");
        }
        return "md";
      },
    });
    const published = Promise.withResolvers<string>();
    const off = subscribe(h.index.runtime, h.index["changed"], (path) =>
      published.resolve(path),
    );
    h.metadataCache.change(h.draft, "@discarded");
    h.metadataCache.change(h.draft, "@roe2025");
    expect(await published.promise).toBe("draft.md");
    expect(h.index.citationKeys()).toEqual(["roe2025"]);
    off();
  }),
);

it.effect(
  "settles parked readers and preserves the released adapter after whole-runtime disposal (#1705)",
  () =>
    Effect.promise(async () => {
      await using h = await createCitationIndexHarness({
        "draft.md": "@doe2024",
      });
      const service = h.runtime.runSync(CitationIndex);
      const waiting = h.index.whenIndexed();
      const release = h.vault.hold("draft.md");
      const scan = h.index.getFileScan(h.draft);
      await h.runtime.dispose();
      release();
      await waiting;
      expect(await scan).toBeNull();
      await expect(h.index.whenIndexed()).resolves.toBeUndefined();
      await expect(h.index.reset()).resolves.toBeUndefined();
      await expect(
        h.index.getDocumentCitationSet(h.draft),
      ).rejects.toMatchObject({ name: "AbortError" });
      expect(h.index.current.stopped).toBe(true);
      const delivered: string[] = [];
      subscribe(h.index.runtime, h.index["changed"], (path) =>
        delivered.push(path),
      );
      h.metadataCache.change(h.draft, "@roe2025");
      expect(delivered).toEqual([]);
      return service;
    }).pipe(
      Effect.flatMap((service) => Stream.runHead(service.changes)),
      Effect.tap((state) =>
        Effect.sync(() =>
          expect(state).toMatchObject({ value: { stopped: true } }),
        ),
      ),
    ),
);

it.effect(
  "preserves AbortError when a document lookup is cancelled (#1705)",
  () =>
    Effect.promise(async () => {
      await using h = await createCitationIndexHarness({
        "draft.md": "@doe2024",
      });
      const held = h.db.holdLookup();
      const controller = new AbortController();
      const pending = h.index.getDocumentCitationSet(h.draft, {
        signal: controller.signal,
      });
      const rejected = expect(pending).rejects.toMatchObject({
        name: "AbortError",
      });
      await held.entered;
      controller.abort();
      held.release();
      await rejected;
    }),
);

it.effect("preserves the base AbortError after lookup disposal (#1705)", () =>
  Effect.promise(async () => {
    await using h = await createCitationIndexHarness({
      "draft.md": "@doe2024",
    });
    h.workspace.layoutReady();
    await h.index.whenIndexed();
    await h.lookup.runtime.dispose();
    await expect(h.index.getCitedBy(KEY_A)).rejects.toMatchObject({
      name: "AbortError",
    });
  }),
);

it.effect(
  "does not repeat reset or file reads while another fiber delays shutdown (#1705)",
  () =>
    Effect.promise(async () => {
      const clearing = Promise.withResolvers<void>();
      const clear = Promise.withResolvers<void>();
      let parsed: PromiseWithResolvers<void> | undefined;
      const stopping = Promise.withResolvers<void>();
      const stop = Promise.withResolvers<void>();
      const started = Promise.withResolvers<void>();
      const store = new MemoryStore();
      let clears = 0;
      store.clear = async () => {
        clears += 1;
        clearing.resolve();
        await clear.promise;
        store.records.clear();
      };
      await using h = await createCitationIndexHarness(
        { "draft.md": "@doe2024" },
        {
          store,
          notes: false,
          parseClient: {
            parse: effectTestParse(async (request, signal) => {
              const reply = await Effect.runPromise(
                inProcessParseClient.parse(request),
                { signal },
              );
              parsed?.resolve();
              return reply;
            }),
          },
        },
      );
      h.workspace.layoutReady();
      await h.index.whenIndexed();
      h.vault.reads.length = 0;
      parsed = Promise.withResolvers<void>();
      h.runtime.runFork(
        Effect.sync(() => started.resolve()).pipe(
          Effect.andThen(Effect.never),
          Effect.ensuring(
            Effect.promise(() => {
              stopping.resolve();
              return stop.promise;
            }),
          ),
        ),
      );
      await started.promise;
      const reset = h.index.reset();
      await clearing.promise;
      const closing = h.runtime.dispose();
      await stopping.promise;
      clear.resolve();
      // The original reset can start its backfill while the other finalizer is held.
      await parsed.promise;
      stop.resolve();
      await closing;
      await reset;
      expect(clears).toBe(1);
      expect(h.vault.reads.length).toBe(new Set(h.vault.reads).size);
    }),
);

it.effect(
  "starts within the bound while the store stalls, then writes earlier scans and drops through (#1705)",
  () =>
    Effect.gen(function* () {
      const context = yield* Effect.context<never>();
      const store = new MemoryStore();
      const documents = { "draft.md": "@doe2024", "gone.md": "@roe2020" };
      yield* Effect.promise(async () => {
        await using seed = await createCitationIndexHarness(documents, {
          store,
          notes: false,
        });
        await seed.index.getFileScan(seed.draft);
        await seed.index.getFileScan(seed.metadataCache.files.get("gone.md")!);
      });
      const release = Promise.withResolvers<void>();
      const written = Promise.withResolvers<void>();
      const put = store.put.bind(store);
      store.put = async (record) => {
        await put(record);
        if (record.path === "draft.md") written.resolve();
      };
      const h = yield* Effect.acquireRelease(
        Effect.promise(() =>
          createCitationIndexHarness(
            { ...documents, "draft.md": "@smith2021" },
            {
              context,
              notes: false,
              awaitReady: false,
              openStore: async () => {
                await release.promise;
                return store;
              },
            },
          ),
        ),
        (h) => Effect.promise(() => h[Symbol.asyncDispose]()),
      );
      yield* TestClock.adjust("5 seconds");
      yield* Effect.promise(() => h.ready);
      yield* Effect.promise(() => h.index.getFileScan(h.draft));
      h.vault.deleteFile(h.metadataCache.files.get("gone.md")!);
      release.resolve();
      yield* Effect.promise(() => written.promise);
      expect(JSON.stringify(store.records.get("draft.md"))).toContain(
        "smith2021",
      );
      expect(store.records.has("gone.md")).toBe(false);
      expect(h.index.citationKeys()).toEqual(["smith2021"]);
    }),
);
