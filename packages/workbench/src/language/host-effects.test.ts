import { Effect, Exit, Fiber, Scope } from "effect";
import type { Fiber as FiberType } from "effect";
import { describe, expect, it } from "vitest";

import { joinForked, observeExit } from "./host-effects";

describe("joinForked", () => {
  it("interrupts the forked Fiber when the caller is interrupted as it starts", async () => {
    const scope = Scope.makeUnsafe();
    let caller: FiberType.Fiber<unknown, unknown> | undefined;
    let stopped = false;
    // The forked Effect interrupts its caller on its first step, while the
    // caller is still between the fork and the join.
    const child = Effect.sync(() => caller?.interruptUnsafe()).pipe(
      Effect.andThen(Effect.never),
      Effect.onInterrupt(() =>
        Effect.sync(() => {
          stopped = true;
        }),
      ),
    );
    const exit = await Effect.runPromise(
      Effect.withFiber((self) => {
        caller = self;
        return joinForked(
          Effect.forkIn(child, scope, { startImmediately: true }),
        );
      }).pipe(Effect.forkDetach, Effect.flatMap(Fiber.await)),
    );
    expect(Exit.hasInterrupts(exit)).toBe(true);
    expect(stopped).toBe(true);
    await Effect.runPromise(Scope.close(scope, Exit.void));
  });
});

describe("observeExit", () => {
  it("reports a success, a failure, and an end by interrupts only", async () => {
    const seen: string[] = [];
    const report = (fiber: FiberType.Fiber<string, string>) =>
      observeExit(fiber, {
        onSuccess: (value) => seen.push(`success ${value}`),
        onFailure: (error) => seen.push(`failure ${String(error)}`),
        onInterrupt: () => seen.push("interrupt"),
      });
    for (const effect of [
      Effect.succeed("a"),
      Effect.fail("b"),
      Effect.interrupt,
    ]) {
      const fiber = Effect.runFork(effect);
      await Effect.runPromise(Fiber.await(fiber));
      report(fiber);
    }
    expect(seen).toEqual(["success a", "failure b", "interrupt"]);
  });
});
