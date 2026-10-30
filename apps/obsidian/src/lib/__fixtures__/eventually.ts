// Bounded polls for a test that waits on a forked fiber, with no time passing.
import { Effect, Exit } from "effect";
import { expect } from "vitest";

/**
 * Yield until `assert` passes, for a forked fiber (a toast) to take in what
 * just happened. After a bounded number of turns, the case dies with the last
 * assertion failure.
 */
export const eventually = (assert: () => void) =>
  Effect.yieldNow.pipe(
    Effect.andThen(Effect.exit(Effect.sync(assert))),
    Effect.repeat({ until: Exit.isSuccess, times: 1000 }),
    Effect.flatten,
  );

/** {@link eventually} for a condition: yield until `done` holds. */
export const until = (done: () => boolean) =>
  eventually(() => expect(done()).toBe(true));
