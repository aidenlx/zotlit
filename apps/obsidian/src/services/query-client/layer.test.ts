import { it } from "@effect/vitest";
import {
  Context,
  Effect,
  Exit,
  Fiber,
  Layer,
  Queue,
  Scope,
  Stream,
} from "effect";
import { TestClock } from "effect/testing";
import { expect } from "vitest";

import type { HeldReadChange } from "./service";
import { layerQueryClients, QueryClients } from "./service";

it.effect("releases held values and pending reads when its scope closes", () =>
  Effect.gen(function* () {
    const scope = yield* Effect.acquireRelease(Scope.make(), (scope) =>
      Scope.close(scope, Exit.void),
    );
    const context = yield* Layer.buildWithScope(layerQueryClients, scope);
    const queries = Context.get(context, QueryClients);
    yield* queries.ask(["held"], () => Promise.resolve("old"));
    const gate = Promise.withResolvers<string>();
    const started = Promise.withResolvers<void>();
    const reading = yield* Effect.forkChild(
      queries.read(["pending"], () => {
        started.resolve();
        return gate.promise;
      }),
    );
    yield* Effect.promise(() => started.promise);
    yield* Scope.close(scope, Exit.void);
    gate.resolve("late");
    expect(yield* queries.peek(["held"])).toBeNull();
    expect(
      yield* queries.read(["closed"], () => Promise.resolve("new")),
    ).toBeNull();
    expect(yield* Fiber.join(reading)).toBeNull();
  }),
);

it.effect(
  "uses TestClock for the failure cooldown and clears it on invalidation",
  () =>
    Effect.gen(function* () {
      const context = yield* Layer.build(layerQueryClients);
      const queries = Context.get(context, QueryClients);
      let calls = 0;
      const fail = () => {
        calls++;
        return Promise.reject(new Error("unreadable"));
      };
      yield* queries.ask(["failed"], fail);
      yield* TestClock.adjust(5001);
      yield* queries.ask(["failed"], fail);
      expect(calls).toBe(2);
      yield* queries.ask(["failed"], fail);
      expect(calls).toBe(2);
      yield* queries.invalidate(["failed"]);
      expect(
        yield* queries.readFresh(["failed"], () =>
          Promise.resolve("recovered"),
        ),
      ).toBe("recovered");
    }),
);

it.effect(
  "publishes settlements through changes and stops subscriptions on scope close",
  () =>
    Effect.gen(function* () {
      const scope = yield* Effect.acquireRelease(Scope.make(), (scope) =>
        Scope.close(scope, Exit.void),
      );
      const queries = Context.get(
        yield* Layer.buildWithScope(layerQueryClients, scope),
        QueryClients,
      );
      const changes = yield* Queue.unbounded<HeldReadChange>();
      const listening = yield* Stream.runForEach(queries.changes, (change) =>
        Queue.offer(changes, change),
      ).pipe(Effect.forkScoped({ startImmediately: true }));
      yield* queries.read(["held"], () => Promise.resolve("first"));
      expect(yield* Queue.take(changes)).toMatchObject({
        key: ["held"],
        held: { value: "first" },
        changed: true,
      });
      let events = 0;
      yield* queries.watch([], {
        settled: () => {
          events++;
        },
      });
      yield* Scope.close(scope, Exit.void);
      yield* Fiber.join(listening);
      queries.client.setQueryData(["after close"], "ignored");
      expect(events).toBe(0);
    }),
);
