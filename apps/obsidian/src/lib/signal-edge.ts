// The edge where a plain caller's AbortSignal ends an Effect run.
//
// Imports only `effect`, so the database reads worker can run it too.
import { Cause, Exit } from "effect";

/**
 * What a run started with `runPromiseExit(effect, { signal })` settled to, for
 * a plain caller: the value of a success, `signal.reason` thrown where the
 * signal ended the run, `released()` where only other interrupts ended it (the
 * runtime closed under it) when the caller has an answer for that, and the
 * squashed cause thrown otherwise.
 */
export function settleAtEdge<A, E>(
  exit: Exit.Exit<A, E>,
  signal: AbortSignal | undefined,
  released?: () => A,
): A {
  if (Exit.isSuccess(exit)) return exit.value;
  if (Cause.hasInterruptsOnly(exit.cause)) {
    if (signal?.aborted) throw signal.reason;
    if (released !== undefined) return released();
  }
  throw Cause.squash(exit.cause);
}
