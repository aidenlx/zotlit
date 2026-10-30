// The edge between Effect's dates and the Temporal of plain code: the Effect
// Clock as a Temporal or DateTime clock, and a DateTime as a Temporal.Instant
// and back.
import { DateTime, Option } from "effect";
import type { Clock } from "effect";

/** Read `clock` as an Instant: the live clock in the plugin, TestClock in a test. */
export function instantClock(clock: Clock.Clock): () => Temporal.Instant {
  return () =>
    Temporal.Instant.fromEpochMilliseconds(clock.currentTimeMillisUnsafe());
}

/** Read `clock` as a DateTime.Utc: the live clock in the plugin, TestClock in a test. */
export function dateTimeClock(clock: Clock.Clock): () => DateTime.Utc {
  return () => DateTime.makeUnsafe(clock.currentTimeMillisUnsafe());
}

/** `dateTime` as the Temporal.Instant of plain code: the same instant. */
export function toInstant(dateTime: DateTime.DateTime): Temporal.Instant {
  return Temporal.Instant.fromEpochMilliseconds(
    DateTime.toEpochMillis(dateTime),
  );
}

/**
 * `instant` as a DateTime.Utc: a Temporal.Instant, or any value that carries
 * its epoch milliseconds. A DateTime holds milliseconds, so a finer part of
 * `instant` is dropped.
 */
export function fromInstant(instant: {
  readonly epochMilliseconds: number;
}): DateTime.Utc {
  return DateTime.makeUnsafe(instant.epochMilliseconds);
}

/** `text` read as Temporal reads an instant's ISO form, or none when Temporal rejects it. */
export function parseInstant(text: string): Option.Option<DateTime.Utc> {
  try {
    return Option.some(fromInstant(Temporal.Instant.from(text)));
  } catch {
    return Option.none();
  }
}
