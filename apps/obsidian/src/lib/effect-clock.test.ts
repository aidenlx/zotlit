import { Duration } from "effect";
import { describe, expect, it } from "vitest";

import { stringifyInstant } from "./constants";
import {
  fromInstant,
  fromTemporalDuration,
  toInstant,
  toTemporalDuration,
} from "./effect-clock";

describe("effect-clock edge", () => {
  it.each([
    { seconds: 97 },
    { minutes: 1, milliseconds: 500 },
    { milliseconds: 1 },
  ])("keeps %o through a Duration", (parts) => {
    const span = Temporal.Duration.from(parts);
    const back = toTemporalDuration(fromTemporalDuration(span));
    expect(back.total({ unit: "millisecond" })).toBe(
      span.total({ unit: "millisecond" }),
    );
  });

  it("reads the span of a Duration in each direction", () => {
    expect(
      toTemporalDuration(Duration.seconds(97)).total({ unit: "second" }),
    ).toBe(97);
    expect(
      Duration.toMillis(
        fromTemporalDuration(Temporal.Duration.from({ seconds: 97 })),
      ),
    ).toBe(97_000);
  });

  it.each([
    "2024-01-15T10:00:00Z",
    "2024-01-15T10:00:00.12Z",
    "2024-01-15T10:00:00.999Z",
  ])("keeps %s through a DateTime", (text) => {
    const instant = Temporal.Instant.from(text);
    const back = toInstant(fromInstant(instant));
    expect(back.equals(instant)).toBe(true);
    expect(back.toString()).toBe(text);
  });

  it("writes the same note strings through a DateTime", () => {
    const instant = Temporal.Instant.from("2024-01-15T10:00:00.5Z");
    const back = toInstant(fromInstant(instant));
    expect(stringifyInstant(back, { utc: true })).toBe(
      stringifyInstant(instant, { utc: true }),
    );
    expect(stringifyInstant(back)).toBe(stringifyInstant(instant));
  });

  it("drops the part of an instant finer than a millisecond", () => {
    const instant = Temporal.Instant.from("2024-01-15T10:00:00.123456Z");
    expect(toInstant(fromInstant(instant)).toString()).toBe(
      "2024-01-15T10:00:00.123Z",
    );
  });
});
