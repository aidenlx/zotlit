import { Scheduler } from "effect/Scheduler";
import { expect, it } from "vitest";

import { browserScheduler } from "./browser-scheduler";
import { Context, Effect, Exit, Fiber, FiberSet, Scope } from "./effect";

// Failure modes: raw root defaults, explicit-context roots, synchronous runtime
// factories, and cancellation losing the supplied AbortSignal.
it("uses Chromium scheduling in every async entry point", async () => {
  const context = Context.empty();
  const check = Effect.gen(function* () {
    yield* Effect.yieldNow;
    return yield* Scheduler;
  });
  for (const run of [Effect.runPromise, Effect.runPromiseWith(context)]) {
    expect(await run(check)).toBe(browserScheduler);
  }
  for (const run of [
    Effect.runPromiseExit,
    Effect.runPromiseExitWith(context),
  ]) {
    expect(await run(check)).toEqual(Exit.succeed(browserScheduler));
  }
  for (const run of [Effect.runFork, Effect.runForkWith(context)]) {
    expect(await Effect.runPromise(Fiber.join(run(check)))).toBe(
      browserScheduler,
    );
  }
  for (const run of [Effect.runCallback, Effect.runCallbackWith(context)]) {
    const result = await new Promise((resolve) =>
      run(check, { onExit: resolve }),
    );
    expect(result).toEqual(Exit.succeed(browserScheduler));
  }
});

it("uses Chromium scheduling in sync entry points and captured background runtimes", async () => {
  const context = Context.empty();
  for (const run of [Effect.runSync, Effect.runSyncWith(context)]) {
    expect(run(Scheduler)).toBe(browserScheduler);
    const scope = run(Scope.make());
    try {
      const background = run(
        Scope.provide(FiberSet.makeRuntimePromise(), scope),
      );
      expect(await background(Scheduler)).toBe(browserScheduler);
    } finally {
      await Effect.runPromise(Scope.close(scope, Exit.void));
    }
  }
  for (const run of [Effect.runSyncExit, Effect.runSyncExitWith(context)]) {
    expect(run(Scheduler)).toEqual(Exit.succeed(browserScheduler));
  }
});

it("preserves cancellation options", async () => {
  const controller = new AbortController();
  const pending = Effect.runPromiseExit(Effect.never, {
    signal: controller.signal,
  });
  controller.abort();
  expect(Exit.isFailure(await pending)).toBe(true);
});
