import { TestClock } from "effect/testing";
import { expect } from "vitest";

import { Context, Deferred, Effect, Fiber, Layer, Stream } from "@/lib/effect";
import { it } from "@/lib/effect-vitest";

import { layerRcRef } from "./connection";
import { layerZoteroReads, ZoteroReads } from "./service";
import { inProcessClient, memoryOpener } from "./test-utils";

// #1705: startup waits for the feed seed; database progress remains state.
it.effect("publishes the first database connection through state", () =>
  Effect.gen(function* () {
    const { open } = memoryOpener(
      () =>
        "insert into libraries (libraryID, type, version) values (1, 'user', 7);",
    );
    const service = Context.get(
      yield* Layer.build(layerZoteroReads(inProcessClient(layerRcRef(open)))),
      ZoteroReads,
    );
    yield* Stream.runHead(
      Stream.filter(service.changes, (state) => state.state === "ready"),
    );
    expect(yield* service.reads.Libraries({})).toMatchObject([{ version: 7 }]);
  }),
);

it.effect(
  "builds from the loading seed while the first database read is stalled",
  () =>
    Effect.gen(function* () {
      const { open } = memoryOpener(() => "");
      const started = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const client = Effect.map(
        inProcessClient(layerRcRef(open)),
        (client) => ({
          ...client,
          Libraries: ((...args: Parameters<typeof client.Libraries>) =>
            Deferred.succeed(started, undefined).pipe(
              Effect.andThen(Deferred.await(release)),
              Effect.andThen(client.Libraries(...args)),
            )) as typeof client.Libraries,
        }),
      );
      let built = false;
      let initialState: string | undefined;
      const opening = yield* Layer.build(layerZoteroReads(client)).pipe(
        Effect.tap((context) =>
          Effect.gen(function* () {
            initialState = (yield* Context.get(context, ZoteroReads).current)
              .state;
            built = true;
          }),
        ),
        Effect.forkChild,
      );
      yield* Deferred.await(started);
      yield* TestClock.adjust("5 minutes");
      const builtWhileStalled = built;
      yield* Deferred.succeed(release, undefined);
      const service = Context.get(yield* Fiber.join(opening), ZoteroReads);
      expect(builtWhileStalled).toBe(true);
      expect(initialState).toBe("loading");
      yield* Stream.runHead(
        Stream.filter(service.changes, (state) => state.state === "ready"),
      );
    }),
);
