import { describe, expect, it } from "@effect/vitest";
import { Deferred, Effect, Exit, Fiber } from "effect";

import { awaitOwned } from "./effect-fiber";

describe("awaitOwned", () => {
  it.effect("gives how the fiber ended", () =>
    Effect.gen(function* () {
      const fiber = yield* Effect.forkDetach(Effect.succeed(1));

      expect(yield* awaitOwned(fiber)).toEqual(Exit.succeed(1));
    }),
  );

  it.effect("interrupts the fiber when the caller is interrupted", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const owned = yield* Effect.forkDetach(
        Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
      );
      const caller = yield* Effect.forkChild(awaitOwned(owned), {
        startImmediately: true,
      });
      yield* Deferred.await(started);

      yield* Fiber.interrupt(caller);

      expect(Exit.hasInterrupts(yield* Fiber.await(owned))).toBe(true);
    }),
  );
});
