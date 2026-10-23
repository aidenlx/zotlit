import type { EventRef, Events } from "obsidian";
import { expect } from "vitest";

import { Effect, Exit, Scope, Stream } from "@/lib/effect";
import { obsidianEvents } from "@/lib/effect-obsidian-events";
import { it } from "@/lib/effect-vitest";

// Host boundary: each registration has the same lifetime as its owning Scope.
it.effect("unregisters the Obsidian event when its scope closes", () =>
  Effect.gen(function* () {
    const listeners = new Set<(...args: unknown[]) => void>();
    const source: Pick<Events, "on" | "offref"> = {
      on: (_name, callback) => {
        listeners.add(callback);
        return { callback } as unknown as EventRef;
      },
      offref: (ref) => {
        listeners.delete(
          (ref as unknown as { callback: (...args: unknown[]) => void })
            .callback,
        );
      },
    };
    const scope = yield* Effect.acquireRelease(Scope.make(), (scope) =>
      Scope.close(scope, Exit.void),
    );
    const events = yield* obsidianEvents<{ changed: [string] }>().pipe(
      Scope.provide(scope),
    );
    yield* events.on("changed", source, "changed").pipe(Scope.provide(scope));
    expect(listeners.size).toBe(1);
    yield* Scope.close(scope, Exit.void);
    expect(listeners.size).toBe(0);
  }),
);

it.effect(
  "keeps two published events in arrival order before consumption starts",
  () =>
    Effect.gen(function* () {
      const events = yield* obsidianEvents<{
        changed: [string, number];
        deleted: [string];
      }>();
      events.callback("changed")("paper.md", 1);
      events.callback("deleted")("paper.md");
      const received = yield* events.stream.pipe(
        Stream.take(2),
        Stream.runCollect,
      );
      expect(received).toEqual([
        { type: "changed", args: ["paper.md", 1] },
        { type: "deleted", args: ["paper.md"] },
      ]);
    }),
);
