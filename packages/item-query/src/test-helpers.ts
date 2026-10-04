import { Clock, Context, Effect } from "effect";
import type { Exit, Scheduler } from "effect";

// The test helper of the package: plain Vitest, no `@effect/vitest`.
import type { NodeDatabaseClient } from "@zotlit/db/client/node";
import {
  ItemQueryDatabase,
  ItemQueryStatementObserver,
} from "@zotlit/db/item-query";
import type { StatementRun } from "@zotlit/db/item-query";

import { QueryTimeZone } from "./query-clock";
import { ItemQueryScheduler, ItemQuerySliceObserver } from "./scheduler";
import { ItemQueryTuning, PRODUCTION_TUNING } from "./tuning";
import type { Tuning } from "./tuning";

export interface RunOptions {
  /** The leased client the readers use. Omit it for an Effect that reads no database. */
  client?: NodeDatabaseClient;
  /**
   * The instant of the Query Clock, as an ISO string.
   *
   * @default TEST_NOW
   */
  now?: string;
  /**
   * The zone of the Query Clock.
   *
   * @default "UTC"
   */
  timeZone?: string;
  signal?: AbortSignal;
  /** Values of the tuning reference that replace the production defaults. */
  tuning?: Partial<Tuning>;
  /** The scheduler of the run, in place of the test scheduler. */
  scheduler?: Scheduler.Scheduler;
  /** Called with each event of the run, in the step that produces it. */
  onEvent?: (event: RunEvent) => void;
  /**
   * `false` keeps no statement in `Run.events`, so the run holds no row that
   * the engine has released.
   *
   * @default true
   */
  keepStatements?: boolean;
}

/** A statement of a reader, or a pause of the scheduler. */
export type RunEvent =
  | { readonly type: "statement"; readonly statement: StatementRun }
  | { readonly type: "pause" };

export interface Run<A, E> {
  exit: Exit.Exit<A, E>;
  /** The times the scheduler paused the fiber. */
  pauses: number;
  /** The statements and the pauses of the run, in order. */
  events: RunEvent[];
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
  const events: RunEvent[] = [];
  const record = (event: RunEvent) => {
    if (event.type === "pause" || options.keepStatements !== false) {
      events.push(event);
    }
    options.onEvent?.(event);
  };
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
    )
    .pipe(
      Context.add(ItemQueryStatementObserver, (statement) =>
        record({ type: "statement", statement }),
      ),
    )
    .pipe(
      Context.add(ItemQuerySliceObserver, {
        paused: () => record({ type: "pause" }),
        resumed: () => {},
      }),
    );
  const exit = await Effect.runPromiseExit(
    Effect.provideContext(effect, services),
    { scheduler: options.scheduler ?? testScheduler(), signal: options.signal },
  );
  const pauses = events.filter((event) => event.type === "pause").length;
  return { exit, pauses, events };
}

/**
 * The production scheduler on a counter in place of a timer: every time read
 * is one tick, so no run depends on wall time. A resumed fiber needs two ticks
 * to return to its operation, so a budget of three ticks gives slices of one
 * operation.
 */
function testScheduler(): ItemQueryScheduler {
  let ticks = 0;
  return new ItemQueryScheduler({ budgetMs: 3, now: () => ticks++ });
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
