import { describe, expect, it } from "vitest";

import { stringifyInstant } from "./constants";
import { fromInstant, toInstant } from "./effect-clock";

describe("effect-clock edge", () => {
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
