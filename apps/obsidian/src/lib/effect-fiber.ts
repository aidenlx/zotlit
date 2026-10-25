// Waiting for a fiber that the caller owns, such as one in a FiberMap.
import { Effect, Fiber } from "effect";
import type { Exit } from "effect";

/**
 * How `fiber` ended. Interrupting the caller interrupts `fiber` and waits for
 * it to end.
 *
 * Fork `fiber` inside `Effect.uninterruptibleMask` and pass its `restore`:
 * then no interrupt reaches the caller between the fork and the wait, and the
 * fiber always has an owner.
 */
export function awaitOwned<A, E>(
  fiber: Fiber.Fiber<A, E>,
  restore: (
    self: Effect.Effect<Exit.Exit<A, E>>,
  ) => Effect.Effect<Exit.Exit<A, E>> = (self) => self,
): Effect.Effect<Exit.Exit<A, E>> {
  return restore(Fiber.await(fiber)).pipe(
    Effect.onInterrupt(() => Fiber.interrupt(fiber)),
  );
}
