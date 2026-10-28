// A test's own runs of Effects on the view services of a registry.
import { Cause, Effect, Exit } from "effect";
import type { Fiber } from "effect";

import type { ViewServices } from "@/lib/view-atoms";
import { makeViewRunner } from "@/lib/view-runner";

/**
 * How `fiber` ended, for a test that reads the Exit. An interrupt-only Exit
 * means the view closed or a newer run superseded it.
 */
export function exitOf<A, E>(
  fiber: Fiber.Fiber<A, E>,
): Promise<Exit.Exit<A, E>> {
  return new Promise((resolve) => fiber.addObserver(resolve));
}

/** A view runner over `registry`, closed with the test's Scope. */
export const scopedViewRunner = (
  registry: Parameters<typeof makeViewRunner>[0],
) => Effect.acquireDisposable(Effect.sync(() => makeViewRunner(registry)));

/**
 * Runs `effect` on a view runner of its own, which closes once the run ends.
 * A failure rejects with the squashed cause.
 */
export async function runOnView<A, E>(
  registry: Parameters<typeof makeViewRunner>[0],
  effect: Effect.Effect<A, E, ViewServices>,
): Promise<A> {
  await using runner = makeViewRunner(registry);
  const exit = await exitOf(runner.run(effect));
  if (Exit.isSuccess(exit)) return exit.value;
  throw Cause.squash(exit.cause);
}
