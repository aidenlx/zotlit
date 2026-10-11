import { Effect, Exit } from "effect";
import { createHook } from "node:async_hooks";
import { describe, expect, it, vi } from "vitest";

import { ItemQueryScheduler } from "@zotlit/item-query";

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

const reportOf = (trace: ReturnType<typeof createTrace>) =>
  finishTrace(trace, {
    startedAt: performance.timeOrigin,
    answerSteps: [],
  });

describe("Item Query execution slices", () => {
  it.each([60, 600])(
    "keeps a %i ms asynchronous wait out of execution slices",
    async (waitMs) => {
      using time = clock();
      const trace = createTrace(false);
      await Effect.runPromise(
        trace.instrument(
          Effect.gen(function* () {
            yield* Effect.sync(() => time.work(2));
            yield* Effect.promise(() => time.wait(waitMs));
            yield* Effect.sync(() => time.work(3));
          }),
        ),
        { scheduler: new ItemQueryScheduler({ budgetMs: 8 }) },
      );
      const report = reportOf(trace);
      expect(report.engineMs).toBe(waitMs + 5);
      expect(report.slices.filter((ms) => ms > 0)).toEqual([2, 3]);
    },
  );

  it("keeps a synchronous stall in its execution slice", async () => {
    using time = clock();
    const trace = createTrace(false);
    await Effect.runPromise(
      trace.instrument(Effect.sync(() => time.work(60))),
      {
        scheduler: new ItemQueryScheduler({ budgetMs: 8 }),
      },
    );
    expect(Math.max(...reportOf(trace).slices)).toBe(60);
  });

  it("measures synchronous work in a Promise continuation before Effect resumes", async () => {
    using time = clock();
    const trace = createTrace(false);
    await Effect.runPromise(
      trace.instrument(
        Effect.promise(async () => {
          await time.wait(600);
          time.work(60);
        }),
      ),
      { scheduler: new ItemQueryScheduler({ budgetMs: 8 }) },
    );
    const report = reportOf(trace);
    expect(report.engineMs).toBe(660);
    expect(report.slices.filter((ms) => ms > 0)).toEqual([60]);
  });

  it("keeps promise microtasks in one slice until the scheduler releases the host", async () => {
    using time = clock();
    const trace = createTrace(false);
    await Effect.runPromise(
      trace.instrument(
        Effect.gen(function* () {
          for (let i = 0; i < 6; i++) {
            yield* Effect.sync(() => time.work(3));
            yield* Effect.promise(() => Promise.resolve());
          }
        }),
      ),
      { scheduler: new ItemQueryScheduler({ budgetMs: 8 }) },
    );
    expect(reportOf(trace).slices.filter((ms) => ms > 0)).toEqual([9, 9]);
  });

  // In the Obsidian worker the pause is a Chromium MessageChannel task, which
  // async_hooks does not report: the resume is no Node host callback there.
  it("ends a slice at a scheduler pause that async_hooks does not report", async () => {
    using time = clock();
    const trace = createTrace(false);
    await Effect.runPromise(
      trace.instrument(
        Effect.gen(function* () {
          for (let i = 0; i < 6; i++) yield* Effect.sync(() => time.work(3));
        }),
      ),
      {
        scheduler: new ItemQueryScheduler({
          budgetMs: 8,
          pause: (resume) => {
            queueMicrotask(resume);
            return () => {};
          },
        }),
      },
    );
    const report = reportOf(trace);
    expect(report.pauses).toBe(2);
    expect(report.slices.filter((ms) => ms > 0)).toEqual([9, 9]);
  });

  it("ends a cancelled wait without counting the wait as synchronous work", async () => {
    using time = clock();
    const trace = createTrace(false);
    const controller = new AbortController();
    const exit = await Effect.runPromiseExit(
      trace.instrument(
        Effect.gen(function* () {
          yield* Effect.sync(() => time.work(2));
          yield* Effect.promise(async () => {
            await time.wait(100);
            controller.abort();
          });
        }),
      ),
      {
        scheduler: new ItemQueryScheduler({ budgetMs: 8 }),
        signal: controller.signal,
      },
    );
    expect(Exit.hasInterrupts(exit)).toBe(true);
    const report = reportOf(trace);
    expect(report.engineMs).toBe(102);
    expect(report.slices.filter((ms) => ms > 0)).toEqual([2]);
  });
});
