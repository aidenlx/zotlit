import { Clock, Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";

import { QueryTimeZone } from "./query-clock";
import { runEffect } from "./test-helpers";

describe("runEffect", () => {
  it("runs an Effect with a fixed clock and a fixed time zone", async () => {
    const read = Effect.gen(function* () {
      return {
        millis: yield* Clock.currentTimeMillis,
        zone: yield* QueryTimeZone,
      };
    });

    const run = await runEffect(read, {
      now: "2020-01-08T02:00:00Z",
      timeZone: "America/New_York",
    });

    expect(run.exit).toEqual(
      Exit.succeed({
        // 2020-01-08T02:00:00Z.
        millis: 1_578_448_800_000,
        zone: "America/New_York",
      }),
    );
  });

  it("uses UTC and one pinned instant when the test names none", async () => {
    const read = Effect.gen(function* () {
      return {
        millis: yield* Clock.currentTimeMillis,
        zone: yield* QueryTimeZone,
      };
    });

    const first = await runEffect(read);
    const second = await runEffect(read);

    expect(first.exit).toEqual(second.exit);
    expect(first.exit).toMatchObject({ value: { zone: "UTC" } });
  });

  it("counts the pauses of the test scheduler, which pauses after every operation", async () => {
    const steps = Effect.gen(function* () {
      let sum = 0;
      for (let i = 1; i <= 5; i++) sum += yield* Effect.sync(() => i);
      return sum;
    });

    const run = await runEffect(steps);

    expect(run.exit).toEqual(Exit.succeed(15));
    expect(run.pauses).toBeGreaterThanOrEqual(5);
  });

  it("reports an interrupted exit when the signal aborts between two slices", async () => {
    const controller = new AbortController();
    let reached = 0;
    const steps = Effect.gen(function* () {
      for (let i = 1; i <= 50; i++) {
        yield* Effect.sync(() => {
          reached = i;
          if (i === 3) controller.abort();
        });
      }
    });

    const run = await runEffect(steps, { signal: controller.signal });

    expect(Exit.hasInterrupts(run.exit)).toBe(true);
    expect(reached).toBe(3);
  });
});
