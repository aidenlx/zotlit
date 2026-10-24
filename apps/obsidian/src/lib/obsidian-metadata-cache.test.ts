import { TFile } from "obsidian";
import type {
  CachedMetadata,
  MetadataCache as MetadataCacheApi,
} from "obsidian";
import { expect } from "vitest";

import { stubService } from "@/lib/__fixtures__/service-stub";
import {
  Context,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  Logger,
  Queue,
  Scope,
  Stream,
} from "@/lib/effect";
import { filterTag, forkEach } from "@/lib/effect-stream";
import { it } from "@/lib/effect-vitest";
import { ObsidianApp } from "@/lib/obsidian-app";
import {
  layerMetadataCache,
  MetadataCache,
} from "@/lib/obsidian-metadata-cache";
import type { MetadataEvent } from "@/lib/obsidian-metadata-cache";

import {
  layerMetadataCacheTest,
  MemoryMetadataCache,
} from "./__fixtures__/obsidian-metadata-cache";

const NAMES = ["changed", "deleted", "resolve", "resolved"] as const;

function file(path: string): TFile {
  const file = new TFile();
  file.path = path;
  return file;
}

const open = Effect.fnUntraced(function* (layer: Layer.Layer<MetadataCache>) {
  const scope = yield* Scope.make();
  const context = yield* Layer.buildWithScope(layer, scope);
  return { scope, metadata: Context.get(context, MetadataCache) };
});

it.effect("owns one listener per event name until the layer closes", () =>
  Effect.gen(function* () {
    const cache = new MemoryMetadataCache();
    const { scope } = yield* open(layerMetadataCacheTest(cache));
    expect(NAMES.map((name) => cache.listenerCount(name))).toEqual([
      1, 1, 1, 1,
    ]);
    yield* Scope.close(scope, Exit.void);
    expect(NAMES.map((name) => cache.listenerCount(name))).toEqual([
      0, 0, 0, 0,
    ]);
  }),
);

it.effect("reads the live layer's cache from ObsidianApp", () =>
  Effect.gen(function* () {
    const cache = new MemoryMetadataCache();
    const entry: CachedMetadata = { frontmatter: { title: "A" } };
    cache.setCache("a.md", entry);
    const { metadata } = yield* open(
      layerMetadataCache.pipe(
        Layer.provide(
          Layer.succeed(
            ObsidianApp,
            stubService<ObsidianApp["Service"]>("ObsidianApp", {
              metadataCache: cache as unknown as MetadataCacheApi,
            }),
          ),
        ),
      ),
    );
    expect(yield* metadata.fileCache(file("a.md"))).toBe(entry);
    expect(yield* metadata.fileCache(file("b.md"))).toBeNull();
  }),
);

it.effect("streams the events of every name in Obsidian's order", () =>
  Effect.gen(function* () {
    const cache = new MemoryMetadataCache();
    const { metadata } = yield* open(layerMetadataCacheTest(cache));
    const received = yield* Queue.unbounded<MetadataEvent["_tag"]>();
    yield* forkEach(metadata.changes, (event) =>
      Queue.offer(received, event._tag),
    );
    const note = file("a.md");
    cache.change(note, {});
    cache.trigger("resolve", note);
    cache.delete(note);
    cache.resolve();
    cache.change(note, {});
    const tags = [];
    for (let i = 0; i < 5; i++) tags.push(yield* Queue.take(received));
    expect(tags).toEqual([
      "changed",
      "resolve",
      "deleted",
      "resolved",
      "changed",
    ]);
  }),
);

it.effect("carries Obsidian's arguments on each event", () =>
  Effect.gen(function* () {
    const cache = new MemoryMetadataCache();
    const { metadata } = yield* open(layerMetadataCacheTest(cache));
    const fiber = yield* metadata.changes.pipe(
      Stream.take(2),
      Stream.runCollect,
      Effect.forkScoped({ startImmediately: true }),
    );
    const note = file("a.md");
    const entry: CachedMetadata = { frontmatter: { a: 1 } };
    cache.change(note, entry, "text");
    cache.delete(note);
    expect([...(yield* Fiber.join(fiber))]).toEqual([
      { _tag: "changed", file: note, data: "text", cache: entry },
      { _tag: "deleted", file: note, prevCache: entry },
    ]);
  }),
);

it.effect(
  "completes whenResolved at the first resolved, and at once after",
  () =>
    Effect.gen(function* () {
      const cache = new MemoryMetadataCache();
      const { metadata } = yield* open(layerMetadataCacheTest(cache));
      const done = yield* Deferred.make<void>();
      yield* metadata.whenResolved.pipe(
        Effect.andThen(Deferred.succeed(done, undefined)),
        Effect.forkScoped,
      );
      cache.change(file("a.md"), {});
      yield* Effect.yieldNow;
      expect(yield* Deferred.isDone(done)).toBe(false);
      cache.resolve();
      yield* Deferred.await(done);
      yield* metadata.whenResolved;
    }),
);

it.effect("logs a failed handler and keeps the subscription", () =>
  Effect.gen(function* () {
    const cache = new MemoryMetadataCache();
    const { metadata } = yield* open(layerMetadataCacheTest(cache));
    const received = yield* Queue.unbounded<string>();
    const logs: unknown[] = [];
    yield* forkEach(filterTag(metadata.changes, "changed"), (event) =>
      event.file.path === "bad.md"
        ? Effect.fail(new Error("handler failed"))
        : Queue.offer(received, event.file.path),
    ).pipe(
      Effect.provide(
        Logger.layer([Logger.make(({ message }) => logs.push(message))]),
      ),
    );
    cache.change(file("bad.md"), {});
    cache.change(file("good.md"), {});
    expect(yield* Queue.take(received)).toBe("good.md");
    expect(logs).toHaveLength(1);
  }),
);
