import type { EventRef, Events } from "obsidian";
import { expect } from "vitest";

import {
  Cause,
  Effect,
  Exit,
  Fiber,
  Logger,
  Queue,
  Scope,
  Stream,
} from "@/lib/effect";
import { LogCategory } from "@/lib/effect-log";
import { obsidianEvents } from "@/lib/effect-obsidian-events";
import { it } from "@/lib/effect-vitest";

// #1705: each host event owns its failure; the next event still reaches the handler.
it.effect.each(["failure", "defect", "throw"] as const)(
  "logs a handler %s and consumes the next event",
  (mode) =>
    Effect.gen(function* () {
      const events = yield* obsidianEvents<{ changed: [number] }>();
      const received = yield* Queue.unbounded<number>();
      const error = new Error("event failed");
      const logs: {
        cause: Cause.Cause<unknown>;
        category: readonly string[];
      }[] = [];
      yield* events
        .consume((event) => {
          if (event.args[0] === 1) {
            if (mode === "throw") throw error;
            return mode === "failure" ? Effect.fail(error) : Effect.die(error);
          }
          return Queue.offer(received, event.args[0]);
        })
        .pipe(
          Effect.provide(
            Logger.layer([
              Logger.make(({ cause, fiber }) => {
                logs.push({ cause, category: fiber.getRef(LogCategory) });
              }),
            ]),
          ),
          Effect.forkScoped,
        );
      events.callback("changed")(1);
      events.callback("changed")(2);
      expect(yield* Queue.take(received)).toBe(2);
      expect(logs).toHaveLength(1);
      expect(Cause.squash(logs[0]!.cause)).toBe(error);
      expect(logs[0]!.category).toEqual(["obsidian-events"]);
    }),
);

it.effect("interruption stops the consumer before the next event (#1705)", () =>
  Effect.gen(function* () {
    const events = yield* obsidianEvents<{ changed: [number] }>();
    const received: number[] = [];
    events.callback("changed")(1);
    events.callback("changed")(2);
    const fiber = yield* events
      .consume((event) => {
        received.push(event.args[0]);
        return Effect.interrupt;
      })
      .pipe(Effect.forkScoped);
    const exit = yield* Fiber.await(fiber);
    expect(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)).toBe(true);
    expect(received).toEqual([1]);
  }),
);

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
