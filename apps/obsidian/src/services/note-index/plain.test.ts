import { expect } from "vitest";

import { Effect } from "@/lib/effect";
import { it } from "@/lib/effect-vitest";

import { cache, makeHarness } from "./__fixtures__";
import type { NoteIndexChange } from "./service";

// Failure modes: replay of the initial state, loss of consecutive events,
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
      const stop = index.subscribe((change) => {
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
      const stopObserver = index.subscribe((change) => {
        if (change.type === "changed") removed.resolve();
      });
      vault.deleteFile("paper.md");
      yield* Effect.promise(() => removed.promise);
      stopObserver();
      expect(received).toHaveLength(2);
      expect(index.getIndexedItemKeys()).toEqual([]);
    }),
);
