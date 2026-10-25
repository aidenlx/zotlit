import { createHook } from "node:async_hooks";
import { describe, expect, vi } from "vitest";

import { ItemQueryScheduler } from "@zotlit/item-query";

import { Effect, Exit, Fiber, Scheduler } from "@/lib/effect";
import { it } from "@/lib/effect-vitest";

import { createTrace, finishTrace } from "./trace";

/** Advance elapsed time before a host callback, as a pending file write would. */
function clock() {
  let now = 0;
  let scheduledWait: number | undefined;
  const waits = new Map<number, number>();
  const hook = createHook({
    init: (id, type) => {
      if (type === "Immediate" && scheduledWait !== undefined) {
        waits.set(id, scheduledWait);
        scheduledWait = undefined;
      }
    },
    before: (id) => {
      now += waits.get(id) ?? 0;
      waits.delete(id);
    },
  }).enable();
  const spy = vi.spyOn(performance, "now").mockImplementation(() => now);
  return {
    work: (ms: number) => {
      now += ms;
    },
    wait: (ms: number) => {
      scheduledWait = ms;
      return new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
    },
    [Symbol.dispose]: () => {
      hook.disable();
      spy.mockRestore();
    },
  };
}

/** `effect` on the time-budget scheduler of a query, as a worker runs it. */
const onScheduler =
  (
    options: ConstructorParameters<typeof ItemQueryScheduler>[0] = {
      budgetMs: 8,
    },
  ) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.provideService(
      effect,
      Scheduler.Scheduler,
      new ItemQueryScheduler(options),
    );

const reportOf = (trace: ReturnType<typeof createTrace>) =>
  finishTrace(trace, {
    startedAt: performance.timeOrigin,
    answerSteps: [],
  });

// Live: the subject is real host callbacks, which async_hooks reports, and
// real waits between them.
describe("Item Query execution slices", () => {
  it.live.each([60, 600])(
    "keeps a %i ms asynchronous wait out of execution slices",
    (waitMs) =>
      Effect.gen(function* () {
        const time = yield* Effect.acquireDisposable(Effect.sync(clock));
        const trace = createTrace(false);
        yield* trace
          .instrument(
            Effect.gen(function* () {
              yield* Effect.sync(() => time.work(2));
              yield* Effect.promise(() => time.wait(waitMs));
              yield* Effect.sync(() => time.work(3));
            }),
          )
          .pipe(onScheduler());
        const report = reportOf(trace);
        expect(report.engineMs).toBe(waitMs + 5);
        expect(report.slices.filter((ms) => ms > 0)).toEqual([2, 3]);
      }),
  );

  it.live("keeps a synchronous stall in its execution slice", () =>
    Effect.gen(function* () {
      const time = yield* Effect.acquireDisposable(Effect.sync(clock));
      const trace = createTrace(false);
      yield* trace
        .instrument(Effect.sync(() => time.work(60)))
        .pipe(onScheduler());
      expect(Math.max(...reportOf(trace).slices)).toBe(60);
    }),
  );

  it.live(
    "measures synchronous work in a Promise continuation before Effect resumes",
    () =>
      Effect.gen(function* () {
        const time = yield* Effect.acquireDisposable(Effect.sync(clock));
        const trace = createTrace(false);
        yield* trace
          .instrument(
            Effect.promise(async () => {
              await time.wait(600);
              time.work(60);
            }),
          )
          .pipe(onScheduler());
        const report = reportOf(trace);
        expect(report.engineMs).toBe(660);
        expect(report.slices.filter((ms) => ms > 0)).toEqual([60]);
      }),
  );

  it.live(
    "keeps promise microtasks in one slice until the scheduler releases the host",
    () =>
      Effect.gen(function* () {
        const time = yield* Effect.acquireDisposable(Effect.sync(clock));
        const trace = createTrace(false);
        yield* trace
          .instrument(
            Effect.gen(function* () {
              for (let i = 0; i < 6; i++) {
                yield* Effect.sync(() => time.work(3));
                yield* Effect.promise(() => Promise.resolve());
              }
            }),
          )
          .pipe(onScheduler());
        expect(reportOf(trace).slices.filter((ms) => ms > 0)).toEqual([9, 9]);
      }),
  );

  // In the Obsidian worker the pause is a Chromium MessageChannel task, which
  // async_hooks does not report: the resume is no Node host callback there.
  it.live(
    "ends a slice at a scheduler pause that async_hooks does not report",
    () =>
      Effect.gen(function* () {
        const time = yield* Effect.acquireDisposable(Effect.sync(clock));
        const trace = createTrace(false);
        yield* trace
          .instrument(
            Effect.gen(function* () {
              for (let i = 0; i < 6; i++)
                yield* Effect.sync(() => time.work(3));
            }),
          )
          .pipe(
            onScheduler({
              budgetMs: 8,
              pause: (resume) => {
                queueMicrotask(resume);
                return () => {};
              },
            }),
          );
        const report = reportOf(trace);
        expect(report.pauses).toBe(2);
        expect(report.slices.filter((ms) => ms > 0)).toEqual([9, 9]);
      }),
  );

  it.live(
    "ends a cancelled wait without counting the wait as synchronous work",
    () =>
      Effect.gen(function* () {
        const time = yield* Effect.acquireDisposable(Effect.sync(clock));
        const trace = createTrace(false);
        // The run interrupts itself once the wait ends, as a cancel would.
        const run: Fiber.Fiber<void> = yield* Effect.forkChild(
          trace
            .instrument(
              Effect.gen(function* () {
                yield* Effect.sync(() => time.work(2));
                yield* Effect.promise(async () => {
                  await time.wait(100);
                  run.interruptUnsafe();
                });
              }),
            )
            .pipe(onScheduler()),
        );
        const exit = yield* Fiber.await(run);
        expect(Exit.hasInterrupts(exit)).toBe(true);
        const report = reportOf(trace);
        expect(report.engineMs).toBe(102);
        expect(report.slices.filter((ms) => ms > 0)).toEqual([2]);
      }),
  );
});
