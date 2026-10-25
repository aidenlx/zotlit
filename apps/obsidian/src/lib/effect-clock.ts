// The Effect Clock as the `Temporal` clock a non-Effect method reads.
import type { Clock } from "effect";

/** Read `clock` as an Instant: the live clock in the plugin, TestClock in a test. */
export function instantClock(clock: Clock.Clock): () => Temporal.Instant {
  return () =>
    Temporal.Instant.fromEpochMilliseconds(clock.currentTimeMillisUnsafe());
}
