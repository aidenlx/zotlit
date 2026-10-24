// A Clock that stands at an Instant a test sets, for a layer that reads time through `Clock.Clock`.
import { Clock, Effect, Layer } from "@/lib/effect";

/** The Clock a layer reads, and the hand a test moves it with. */
export interface ManualClock {
  /** Provide this to the layer under test; it replaces `Clock.Clock`. */
  readonly layer: Layer.Layer<never>;
  /** The Instant the Clock stands at. */
  now(): Temporal.Instant;
  /** Move the Clock to `instant`. */
  set(instant: Temporal.Instant): void;
  /** Move the Clock forward by `duration`. */
  advance(duration: Temporal.DurationLike): void;
}

/**
 * A Clock that stands at `start` until the test moves it. Sleeping and the
 * monotonic reading stay on the live Clock, so only the wall time is fixed.
 */
export function manualClock(start: Temporal.Instant): ManualClock {
  let at = start;
  const layer = Layer.effect(
    Clock.Clock,
    Effect.map(
      Clock.Clock,
      (live): Clock.Clock => ({
        currentTimeMillisUnsafe: () => at.epochMilliseconds,
        currentTimeMillis: Effect.sync(() => at.epochMilliseconds),
        currentTimeNanosUnsafe: () => at.epochNanoseconds,
        currentTimeNanos: Effect.sync(() => at.epochNanoseconds),
        monotonicTimeNanosUnsafe: () => live.monotonicTimeNanosUnsafe(),
        monotonicTimeNanos: live.monotonicTimeNanos,
        sleep: (duration) => live.sleep(duration),
      }),
    ),
  );
  return {
    layer,
    now: () => at,
    set: (instant) => {
      at = instant;
    },
    advance: (duration) => {
      at = at.add(duration);
    },
  };
}
