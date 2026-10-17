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

    const run = await runEffect(read);

    expect(run.exit).toEqual(
      Exit.succeed({
        // TEST_NOW, 2024-07-15T12:00:00Z: 19,919 days after the epoch, at noon.
        millis: 1_721_044_800_000,
        zone: "UTC",
      }),
    );
  });

  it("counts the pauses of the test scheduler, which pauses between every two operations", async () => {
    const log: string[] = [];
    const steps = Effect.gen(function* () {
      for (let i = 1; i <= 5; i++)
        yield* Effect.sync(() => log.push(`step ${i}`));
    });

    const run = await runEffect(steps, {
      onEvent: (event) => log.push(event.type),
    });

    expect(Exit.isSuccess(run.exit)).toBe(true);
    // One pause or more between every two steps, in step order.
    const collapsed = log.filter(
      (entry, i) => entry !== "pause" || log[i - 1] !== "pause",
    );
    expect(
      collapsed.slice(
        collapsed.indexOf("step 1"),
        collapsed.lastIndexOf("step 5") + 1,
      ),
    ).toEqual([
      "step 1",
      "pause",
      "step 2",
      "pause",
      "step 3",
      "pause",
      "step 4",
      "pause",
      "step 5",
    ]);
    expect(run.pauses).toBe(log.filter((entry) => entry === "pause").length);
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
