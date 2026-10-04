import { Clock, Context, Effect } from "effect";
import type { Exit } from "effect";

// The test helper of the package: plain Vitest, no `@effect/vitest`.
import type { NodeDatabaseClient } from "@zotlit/db/client/node";
import { ItemQueryDatabase } from "@zotlit/db/item-query";

import { QueryTimeZone } from "./query-clock";
import { ItemQueryScheduler, messageChannelPause } from "./scheduler";
import { ItemQueryTuning, PRODUCTION_TUNING } from "./tuning";

export interface RunOptions {
  /** The leased client the readers use. Omit it for an Effect that reads no database. */
  client?: NodeDatabaseClient;
  /** The instant of the Query Clock, as an ISO string. Defaults to {@link TEST_NOW}. */
  now?: string;
  /** The zone of the Query Clock. Defaults to `UTC`. */
  timeZone?: string;
  signal?: AbortSignal;
  /** Values of the tuning reference that replace the production defaults. */
  tuning?: Partial<ItemQueryTuning>;
}

export interface Run<A, E> {
  exit: Exit.Exit<A, E>;
  /** The times the test scheduler paused the fiber. */
  pauses: number;
}

export const TEST_NOW = "2024-07-15T12:00:00Z";

/**
 * Run an Effect to its `Exit` in the way the Obsidian adapter does, with a
 * fixed clock, a fixed time zone, and a test scheduler that pauses after every
 * operation and counts its pauses.
 */
export async function runEffect<A, E>(
  effect: Effect.Effect<A, E, ItemQueryDatabase>,
  options: RunOptions = {},
): Promise<Run<A, E>> {
  const scheduler = testScheduler();
  const services = Context.make(
    Clock.Clock,
    fixedClock(options.now ?? TEST_NOW),
  )
    .pipe(Context.add(QueryTimeZone, options.timeZone ?? "UTC"))
    .pipe(
      Context.add(ItemQueryTuning, { ...PRODUCTION_TUNING, ...options.tuning }),
    )
    .pipe(
      Context.add(ItemQueryDatabase, {
        get client(): NodeDatabaseClient {
          if (options.client) return options.client;
          throw new Error("the test passed no database client to runEffect.");
        },
      }),
    );
  const exit = await Effect.runPromiseExit(
    Effect.provideContext(effect, services),
    { scheduler: scheduler.scheduler, signal: options.signal },
  );
  return { exit, pauses: scheduler.pauses() };
}

/**
 * The production scheduler on a counter in place of a timer: every time read
 * is one tick, so no run depends on wall time. A resumed fiber needs two ticks
 * to return to its operation, so a budget of three ticks gives slices of one
 * operation.
 */
function testScheduler() {
  let ticks = 0;
  let pauses = 0;
  const pause = messageChannelPause();
  const scheduler = new ItemQueryScheduler({
    budgetMs: 3,
    now: () => ticks++,
    pause: (resume) => {
      pauses += 1;
      return pause(resume);
    },
  });
  return { scheduler, pauses: () => pauses };
}

function fixedClock(now: string): Clock.Clock {
  const millis = Temporal.Instant.from(now).epochMilliseconds;
  const nanos = BigInt(millis) * 1_000_000n;
  return {
    currentTimeMillisUnsafe: () => millis,
    currentTimeMillis: Effect.succeed(millis),
    currentTimeNanosUnsafe: () => nanos,
    currentTimeNanos: Effect.succeed(nanos),
    monotonicTimeNanosUnsafe: () => nanos,
    monotonicTimeNanos: Effect.succeed(nanos),
    sleep: () => Effect.void,
  };
}
