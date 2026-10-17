import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import { ItemQueryScheduler, ItemQuerySliceObserver } from "./scheduler";

/** `steps` operations that each take `stepMs` of the fake time `clock`. */
function work(steps: number, stepMs: number, clock: { now: number }) {
  return Effect.gen(function* () {
    for (let i = 0; i < steps; i++) {
      yield* Effect.sync(() => {
        clock.now += stepMs;
      });
    }
    return steps;
  });
}

describe("ItemQueryScheduler", () => {
  it("pauses a fiber when a slice has used its 8 ms time budget", async () => {
    const clock = { now: 0 };
    const slices: number[] = [];
    let sliceStart = 0;
    const scheduler = new ItemQueryScheduler({
      budgetMs: 8,
      now: () => clock.now,
      pause: (resume) => {
        slices.push(clock.now - sliceStart);
        const timer = setImmediate(() => {
          sliceStart = clock.now;
          resume();
        });
        return () => clearImmediate(timer);
      },
    });

    // 40 operations of 3 ms: Effect's default scheduler runs them as one slice.
    const result = await Effect.runPromise(work(40, 3, clock), { scheduler });

    expect(result).toBe(40);
    // The third operation of a slice reaches 9 ms >= 8 ms: 40 operations make
    // 13 full slices and a last one of 3 ms that ends without a pause.
    expect(slices).toEqual(Array.from({ length: 13 }, () => 9));
  });

  it("runs a short query as one slice", async () => {
    const clock = { now: 0 };
    const pause = vi.fn((resume: () => void) => {
      const timer = setImmediate(resume);
      return () => clearImmediate(timer);
    });
    const scheduler = new ItemQueryScheduler({ now: () => clock.now, pause });

    await Effect.runPromise(work(2, 1, clock), { scheduler });

    expect(pause).not.toHaveBeenCalled();
  });

  it("pauses with a MessageChannel task by default", async () => {
    const clock = { now: 0 };
    using post = vi.spyOn(MessagePort.prototype, "postMessage");
    using immediate = vi.spyOn(globalThis, "setImmediate");
    using timeout = vi.spyOn(globalThis, "setTimeout");
    const scheduler = new ItemQueryScheduler({ now: () => clock.now });

    const result = await Effect.runPromise(work(40, 3, clock), { scheduler });

    expect(result).toBe(40);
    // The second operation of a slice reaches 6 ms >= SLICE_BUDGET_MS: one
    // pause for every 2 of the 40 operations, the last one included.
    expect(post).toHaveBeenCalledTimes(20);
    expect(immediate).not.toHaveBeenCalled();
    expect(timeout).not.toHaveBeenCalled();
  });

  it("reports each pause and each resume to the slice observer of the run", async () => {
    const clock = { now: 0 };
    const events: [string, number][] = [];
    const scheduler = new ItemQueryScheduler({
      budgetMs: 8,
      now: () => clock.now,
      pause: (resume) => {
        const timer = setImmediate(() => {
          // The host takes 5 ms between two slices.
          clock.now += 5;
          resume();
        });
        return () => clearImmediate(timer);
      },
    });

    // 6 operations of 3 ms: the budget ends after the third and the sixth.
    await Effect.runPromise(
      Effect.provideService(work(6, 3, clock), ItemQuerySliceObserver, {
        paused: (at) => events.push(["paused", at]),
        resumed: (at) => events.push(["resumed", at]),
      }),
      { scheduler },
    );

    expect(events).toEqual([
      ["paused", 9],
      ["resumed", 14],
      ["paused", 23],
      ["resumed", 28],
    ]);
  });

  it("closes each MessageChannel it opens when no resume waits", async () => {
    const clock = { now: 0 };
    let opened = 0;
    using stubs = new DisposableStack();
    stubs.defer(() => vi.unstubAllGlobals());
    vi.stubGlobal(
      "MessageChannel",
      class extends MessageChannel {
        constructor() {
          super();
          opened += 1;
        }
      },
    );
    using close = vi.spyOn(MessagePort.prototype, "close");
    const scheduler = new ItemQueryScheduler({ now: () => clock.now });

    await Effect.runPromise(work(40, 3, clock), { scheduler });

    // One fiber waits at each of the 20 pauses, so each pause opens a channel
    // and its message closes it.
    expect(opened).toBe(20);
    expect(close).toHaveBeenCalledTimes(20);
  });
});
