// What the language layer and the Workbench UI share with the host that runs
// their Effects: the runner, the failure of the host's own work, and how a
// caller reads or joins a Fiber the runner forked.
import { Cause, Data, Effect, Exit, Fiber } from "effect";

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

/** How a Fiber ended, for a caller outside Effect. */
export interface ExitHandlers<A, E> {
  readonly onSuccess?: (value: A) => void;
  readonly onFailure?: (error: unknown, cause: Cause.Cause<E>) => void;
  /** An end by interrupts only: the owner closed, or a newer run replaced it. */
  readonly onInterrupt?: () => void;
}

/**
 * Calls the handler of how `fiber` ends; at once when it has ended already.
 * @returns Stops the report.
 */
export function observeExit<A, E>(
  fiber: Fiber.Fiber<A, E>,
  handlers: ExitHandlers<A, E>,
): () => void {
  return fiber.addObserver((exit) => {
    if (Exit.isSuccess(exit)) handlers.onSuccess?.(exit.value);
    else if (Cause.hasInterruptsOnly(exit.cause)) handlers.onInterrupt?.();
    else handlers.onFailure?.(Cause.squash(exit.cause), exit.cause);
  });
}

/**
 * Runs `fork` and joins the Fiber it answers. The caller's interrupt
 * interrupts that Fiber too, also one that lands as the Fiber starts: the fork
 * and the finalizer run before an interrupt can land. The forked Fiber stays
 * interruptible; a fork is interruptible unless its options ask otherwise.
 */
export function joinForked<A, E, E2, R>(
  fork: Effect.Effect<Fiber.Fiber<A, E>, E2, R>,
): Effect.Effect<A, E | E2, R> {
  return Effect.uninterruptibleMask((restore) =>
    Effect.flatMap(fork, (fiber) =>
      restore(Fiber.join(fiber)).pipe(
        Effect.onInterrupt(() => Fiber.interrupt(fiber)),
      ),
    ),
  );
}
