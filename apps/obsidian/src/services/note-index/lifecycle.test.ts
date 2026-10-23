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
import { it } from "@/lib/effect-vitest";

import {
  cache,
  createNoteHost,
  noteIndexOf,
  noteIndexOver,
  startup,
} from "./__fixtures__";
import { NoteIndex } from "./service";
import type { NoteIndexChange } from "./service";

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
