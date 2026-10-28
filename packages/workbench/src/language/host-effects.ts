// What the language layer and the Workbench UI share with the host that runs
// their Effects: the runner, and the failure of the host's own work.
import { Data } from "effect";
import type { Effect, Fiber } from "effect";

/**
 * Forks an Effect and returns its Fiber: the runner `FiberSet.makeRuntime`
 * returns. Its owner interrupts every Fiber it still runs when the owner goes.
 */
export type WorkbenchRunner = <A, E>(
  effect: Effect.Effect<A, E>,
) => Fiber.Fiber<A, E>;

/**
 * Work the host could not do: a render, a read of the vault's Match
 * vocabulary, or a Shared Partial it could not create. `cause` is the host's
 * own failure, as the engine or the service threw it.
 */
export class WorkbenchHostError extends Data.TaggedError("WorkbenchHostError")<{
  readonly cause: unknown;
}> {}
