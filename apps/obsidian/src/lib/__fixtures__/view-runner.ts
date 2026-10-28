// A test's own run of one Effect on the view services of a registry.
import { Cause, Exit } from "effect";
import type { Effect } from "effect";

import type { ViewServices } from "@/lib/view-atoms";
import { exitOf, makeViewRunner } from "@/lib/view-runner";

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
