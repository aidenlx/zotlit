import { TestClock } from "effect/testing";
import { expect } from "vitest";

import { Context, Deferred, Effect, Fiber, Layer } from "@/lib/effect";
import { it } from "@/lib/effect-vitest";

import { layerRcRef } from "./connection";
import { layerZoteroReads, ZoteroReads } from "./service";
import { inProcessClient, memoryOpener } from "./test-utils";

// #1705: consumers read settled state as soon as the layer is built.
it.effect("builds with the first database connection ready", () =>
  Effect.gen(function* () {
    const { open } = memoryOpener(
      () =>
        "insert into libraries (libraryID, type, version) values (1, 'user', 7);",
    );
    const service = Context.get(
      yield* Layer.build(layerZoteroReads(inProcessClient(layerRcRef(open)))),
      ZoteroReads,
    );
    expect((yield* service.current).state).toBe("ready");
    expect(yield* service.reads.Libraries({})).toMatchObject([{ version: 7 }]);
  }),
);

it.effect(
  "waits for a delayed first connection before publishing the service",
  () =>
    Effect.gen(function* () {
      const { open } = memoryOpener(() => "");
      const started = yield* Deferred.make<void>();
      const client = Effect.map(
        inProcessClient(layerRcRef(open)),
        (client) => ({
          ...client,
          Libraries: ((...args: Parameters<typeof client.Libraries>) =>
            Deferred.succeed(started, undefined).pipe(
              Effect.andThen(Effect.sleep("1 second")),
              Effect.andThen(client.Libraries(...args)),
            )) as typeof client.Libraries,
        }),
      );
      let built = false;
      const opening = yield* Layer.build(layerZoteroReads(client)).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            built = true;
          }),
        ),
        Effect.forkChild,
      );
      yield* Deferred.await(started);
      expect(built).toBe(false);
      yield* TestClock.adjust("1 second");
      const service = Context.get(yield* Fiber.join(opening), ZoteroReads);
      expect((yield* service.current).state).toBe("ready");
    }),
);
