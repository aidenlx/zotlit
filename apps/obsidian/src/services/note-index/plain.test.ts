import { it } from "@effect/vitest";
import { Effect } from "effect";
import { expect } from "vitest";

import { subscribe } from "@/lib/effect-stream";

import { cache, makeHarness } from "./__fixtures__";
import type { NoteIndexChange } from "./service";

// #1705: attaching late must not lose the first invalidations.
it.effect("a throwing subscriber receives both immediate edits (#1705)", () =>
  Effect.gen(function* () {
    const { metadataCache, vault, service } = yield* makeHarness(
      { "first.md": cache({}), "second.md": cache({}) },
      { enabledAtRuntime: true },
    );
    const first = vault.files.get("first.md")!;
    const second = vault.files.get("second.md")!;
    const received: NoteIndexChange[] = [];
    const delivered = Promise.withResolvers<void>();
    const stop = subscribe(service.runtime, service.changes, (change) => {
      received.push(change);
      if (received.length === 1) throw new Error("listener failed");
      if (change.type === "frontmatter-changed" && change.file === second)
        delivered.resolve();
    });
    metadataCache.change(first, cache({ itemKey: "ABCD2345" }));
    metadataCache.change(second, cache({ itemKey: "ZZZ99999" }));
    yield* Effect.promise(() => delivered.promise);
    expect(received).toEqual([
      { type: "changed", file: first },
      { type: "frontmatter-changed", file: first },
      { type: "changed", file: second },
      { type: "frontmatter-changed", file: second },
    ]);
    stop();
  }),
);

// #1705: the owning stack disposes the whole ManagedRuntime, not just its layer.
it.effect("every adapter method remains usable after runtime disposal", () =>
  Effect.gen(function* () {
    const { service, close, metadataCache, vault } = yield* makeHarness(
      {
        "paper.md": cache({
          itemKey: "ABCD2345",
          properties: { topic: "test" },
        }),
        "import.md": { frontmatter: { "zotero-note-key": "ZZZ99999" } },
      },
      { enabledAtRuntime: true },
    );
    const paper = vault.files.get("paper.md")!;
    const imported = vault.files.get("import.md")!;
    const received: NoteIndexChange[] = [];
    const stopBeforeClose = subscribe(
      service.runtime,
      service.changes,
      (change) => received.push(change),
    );
    yield* Effect.promise(close);
    expect(service.getNotesByItemKey("ABCD2345")).toEqual([paper]);
    expect(service.getImportedNoteByNoteKey("ZZZ99999")).toEqual([imported]);
    expect(service.getNotesByProfile("default")).toEqual({
      literatureNotes: [paper],
      importedNotes: [imported],
    });
    expect(service.getPropertyNames()).toEqual(["topic"]);
    expect(service.getIndexedItemKeys()).toEqual(["ABCD2345"]);
    yield* Effect.promise(() => service.whenIndexed());
    yield* Effect.promise(() => service.whenSettled());
    const stop = subscribe(service.runtime, service.changes, (change) =>
      received.push(change),
    );
    const events: string[] = [];
    const stopEvent = subscribe(service.runtime, service["changed"], () =>
      events.push("changed"),
    );
    metadataCache.change(paper, cache({ itemKey: "NEW12345" }));
    vault.deleteFile("paper.md");
    stopBeforeClose();
    stop();
    stopEvent();
    expect(received).toEqual([]);
    expect(events).toEqual([]);
    expect(service.getIndexedItemKeys()).toEqual(["ABCD2345"]);
  }),
);

// Failure modes: a stale event replayed on attach, loss of consecutive events,
// or a callback after unsubscribe.
it.effect(
  "the adapter resolves indexing and subscribes to future changes until unsubscribe",
  () =>
    Effect.gen(function* () {
      const {
        metadataCache,
        vault,
        service: index,
      } = yield* makeHarness(
        { "paper.md": cache({}) },
        { enabledAtRuntime: true },
      );
      yield* Effect.promise(() => index.whenIndexed());
      const received: NoteIndexChange[] = [];
      const delivered = Promise.withResolvers<void>();
      const stop = subscribe(index.runtime, index.changes, (change) => {
        received.push(change);
        if (change.type === "frontmatter-changed") delivered.resolve();
      });
      metadataCache.change(
        vault.files.get("paper.md")!,
        cache({ itemKey: "ABCD2345" }),
      );
      yield* Effect.promise(() => delivered.promise);
      expect(received.map((change) => change.type)).toEqual([
        "changed",
        "frontmatter-changed",
      ]);
      expect(index.getIndexedItemKeys()).toEqual(["ABCD2345"]);
      stop();
      const removed = Promise.withResolvers<void>();
      const stopObserver = subscribe(index.runtime, index.changes, (change) => {
        if (change.type === "changed") removed.resolve();
      });
      vault.deleteFile("paper.md");
      yield* Effect.promise(() => removed.promise);
      stopObserver();
      expect(received).toHaveLength(2);
      expect(index.getIndexedItemKeys()).toEqual([]);
    }),
);
