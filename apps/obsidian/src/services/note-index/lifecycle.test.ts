import { expect } from "vitest";

import {
  Context,
  Effect,
  Exit,
  Fiber,
  Layer,
  Queue,
  Scope,
  Stream,
} from "@/lib/effect";
import { buildRuntime } from "@/lib/effect-layer";
import { acquireAsyncDisposable } from "@/lib/effect-scope";
import { it } from "@/lib/effect-vitest";

import {
  cache,
  createNoteHost,
  noteIndexOf,
  noteIndexOver,
  startup,
} from "./__fixtures__";
import { plainNoteIndex } from "./plain";
import { NoteIndex } from "./service";
import type { NoteIndexChange } from "./service";

// #1705: host callbacks publish; one consumer applies the ordered input.
it.effect(
  "applies a burst of published metadata and vault events in arrival order",
  () =>
    Effect.gen(function* () {
      const host = createNoteHost(
        { "paper.md": cache({}) },
        { enabledAtRuntime: true },
      );
      const index = yield* noteIndexOf(host.app);
      yield* index.whenIndexed();
      const changes = yield* Queue.unbounded<NoteIndexChange>();
      yield* Stream.runForEach(index.changes, (change) =>
        Queue.offer(changes, change),
      ).pipe(Effect.forkScoped);
      yield* Queue.take(changes);
      const file = host.vault.files.get("paper.md")!;
      host.metadataCache.change(file, cache({ itemKey: "ABCD2345" }));
      host.vault.deleteFile("paper.md");
      host.metadataCache.change(file, cache({ itemKey: "ZZZ99999" }));
      yield* index.whenSettled();
      expect(yield* index.getIndexedItemKeys()).toEqual(["ZZZ99999"]);
      const received: NoteIndexChange[] = [];
      for (let i = 0; i < 5; i++) received.push(yield* Queue.take(changes));
      expect(received.map((change) => change.type)).toEqual([
        "changed",
        "frontmatter-changed",
        "changed",
        "changed",
        "frontmatter-changed",
      ]);
    }),
);

// #1705: use the same graph barrier as buildServices before constructing an adapter.
it.effect(
  "the built runtime exposes the first scan when layout and cache are ready",
  () =>
    Effect.gen(function* () {
      const host = createNoteHost(
        { "paper.md": cache({ itemKey: "ABCD2345" }) },
        { enabledAtRuntime: true },
      );
      const stack = yield* acquireAsyncDisposable(
        async () => new AsyncDisposableStack(),
      );
      const runtime = buildRuntime(noteIndexOver(host.app), stack);
      yield* Effect.promise(() => runtime.context());
      const index = plainNoteIndex(runtime);
      expect(index.getNotesByItemKey("ABCD2345")).toEqual([
        host.vault.files.get("paper.md")!,
      ]);
    }),
);

// Legacy ready completed listener registration; whenIndexed was the Full Scan barrier.
it.effect(
  "cold acquisition registers listeners before layout and whenIndexed waits for the clean cache",
  () =>
    Effect.gen(function* () {
      const host = createNoteHost({
        "paper.md": cache({ itemKey: "ABCD2345" }),
      });
      const index = yield* noteIndexOf(host.app);
      const pending = yield* index
        .whenIndexed()
        .pipe(Effect.forkChild({ startImmediately: true }));
      expect(pending.pollUnsafe()).toBeUndefined();
      host.workspace.ready();
      expect(pending.pollUnsafe()).toBeUndefined();
      host.metadataCache.resolve();
      yield* Fiber.join(pending);
      expect(yield* index.getNotesByItemKey("ABCD2345")).toEqual([
        host.vault.files.get("paper.md")!,
      ]);
    }),
);

// #1705: completion covers every queued rename read, including key restoration.
it.effect("whenSettled waits for queued renames to restore their keys", () =>
  Effect.gen(function* () {
    const host = createNoteHost(
      {
        "first.md": cache({ itemKey: "ABCD2345" }),
        "second.md": cache({ itemKey: "ZZZ99999" }),
      },
      { enabledAtRuntime: true },
    );
    const index = yield* noteIndexOf(host.app);
    yield* index.whenSettled();
    host.vault.renameFile("first.md", "first.txt");
    host.vault.renameFile("second.md", "second.txt");
    expect(yield* index.getIndexedItemKeys()).toEqual([]);
    host.vault.renameFile("first.txt", "first.md");
    host.vault.renameFile("second.txt", "second.md");
    yield* index.whenSettled();
    expect(yield* index.getIndexedItemKeys()).toEqual(["ABCD2345", "ZZZ99999"]);
  }),
);

it.effect(
  "scope close settles a pending rename and its whenSettled caller",
  () =>
    Effect.gen(function* () {
      const host = createNoteHost(
        { "paper.txt": cache({ itemKey: "ABCD2345" }) },
        { enabledAtRuntime: true },
      );
      const scope = yield* Effect.acquireRelease(Scope.make(), (scope) =>
        Scope.close(scope, Exit.void),
      );
      const context = yield* Layer.buildWithScope(
        noteIndexOver(host.app),
        scope,
      );
      const index = Context.get(context, NoteIndex);
      host.vault.renameFile("paper.txt", "paper.md");
      const pending = yield* index
        .whenSettled()
        .pipe(Effect.forkChild({ startImmediately: true }));
      expect(pending.pollUnsafe()).toBeUndefined();
      yield* Scope.close(scope, Exit.void);
      yield* Fiber.join(pending);
      yield* index.whenSettled();
      expect(yield* index.getIndexedItemKeys()).toEqual([]);
    }),
);

// Failure modes: close leaves listeners active, or a pending Full Scan runs
// after close and changes the index.
it.effect("scope close stops metadata and vault updates", () =>
  Effect.gen(function* () {
    const host = createNoteHost(
      { "paper.md": cache({ itemKey: "ABCD2345" }) },
      { enabledAtRuntime: true },
    );
    const scope = yield* Effect.acquireRelease(Scope.make(), (scope) =>
      Scope.close(scope, Exit.void),
    );
    const context = yield* Layer.buildWithScope(noteIndexOver(host.app), scope);
    const index = Context.get(context, NoteIndex);
    yield* index.whenIndexed();
    const file = host.vault.files.get("paper.md")!;
    expect(yield* index.getNotesByItemKey("ABCD2345")).toEqual([file]);
    yield* Scope.close(scope, Exit.void);
    host.metadataCache.change(file, cache({ itemKey: "ZZZ99999" }));
    host.vault.deleteFile("paper.md");
    expect(yield* index.getNotesByItemKey("ABCD2345")).toEqual([file]);
    expect(yield* index.getNotesByItemKey("ZZZ99999")).toEqual([]);
  }),
);

it.effect(
  "changes reports the current index and each later edit in order",
  () =>
    Effect.gen(function* () {
      const host = createNoteHost(
        { "paper.md": cache({}) },
        { enabledAtRuntime: true },
      );
      const index = yield* noteIndexOf(host.app);
      const changes = yield* Queue.unbounded<NoteIndexChange>();
      yield* Stream.runForEach(index.changes, (change) =>
        Queue.offer(changes, change),
      ).pipe(Effect.forkScoped);
      expect((yield* Queue.take(changes)).type).toBe("indexed");
      const file = host.vault.files.get("paper.md")!;
      host.metadataCache.change(file, cache({ itemKey: "ABCD2345" }));
      expect(yield* Queue.take(changes)).toEqual({ type: "changed", file });
      expect(yield* Queue.take(changes)).toEqual({
        type: "frontmatter-changed",
        file,
      });
      host.vault.deleteFile("paper.md");
      expect(yield* Queue.take(changes)).toEqual({ type: "changed", file });
      expect(yield* index.getIndexedItemKeys()).toEqual([]);
    }),
);

it.effect.each(["layout", "clean-cache", "resolved"] as const)(
  "scope close settles indexing and stops a late %s callback",
  (phase) =>
    Effect.gen(function* () {
      const host = createNoteHost(
        { "paper.md": cache({ itemKey: "ABCD2345" }) },
        { cleanCacheHook: phase !== "resolved" },
      );
      if (phase === "resolved")
        expect(host.metadataCache.onCleanCache).toBeUndefined();
      const scope = yield* Effect.acquireRelease(Scope.make(), (scope) =>
        Scope.close(scope, Exit.void),
      );
      const context = yield* Layer.buildWithScope(
        noteIndexOver(host.app),
        scope,
      );
      const index = Context.get(context, NoteIndex);
      const pending = yield* index.whenIndexed().pipe(Effect.forkChild);
      if (phase !== "layout") host.workspace.ready();
      yield* Scope.close(scope, Exit.void);
      yield* Fiber.join(pending);
      startup(host);
      expect(yield* index.getIndexedItemKeys()).toEqual([]);
    }),
);
