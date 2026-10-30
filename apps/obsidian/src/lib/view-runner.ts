// Where a view's plain code (an Obsidian callback, a menu item) forks Effect
// work on the view services for as long as the view stands.
//
// The runner forks each gesture on a FiberSet of the view's own and answers
// its Fiber, so the caller can interrupt or supersede that one gesture: an
// annotation insert that a cancelled drag stops, or an Item read that a newer
// selection replaces. Closing the view interrupts every fiber still running.
// What a component reads stays a view atom (ADR 0082).
import { Cause, Effect, Fiber, FiberSet, Scope } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";

import { joinForked, observeExit } from "@zotlit/workbench/ui";

import { openScope } from "./effect-scope";
import { viewRuntime } from "./view-atoms";
import type { ViewServices } from "./view-atoms";

/** Forks `effect` on the view services; the view's close interrupts it. */
export type ViewRun = <A, E>(
  effect: Effect.Effect<A, E, ViewServices>,
) => Fiber.Fiber<A, E>;

export interface ViewRunner extends Disposable, AsyncDisposable {
  readonly run: ViewRun;
  /**
   * `effect` with the view services provided, for a seam that takes an Effect
   * with no requirements, such as a Workbench host member. Its fiber runs on
   * whichever runner forks it.
   */
  readonly provide: <A, E>(
    effect: Effect.Effect<A, E, ViewServices>,
  ) => Effect.Effect<A, E>;
  /** Settles once no fiber of {@link run} is running; at once after disposal. */
  readonly settled: () => Promise<void>;
}

/**
 * A runner over the view services of `registry`, for one view. Its fibers sit
 * in a `FiberSet` on a Scope of the view's own; disposing the runner closes
 * that Scope, which interrupts every fiber still running. The async disposal
 * settles once they have stopped.
 */
export function makeViewRunner(
  registry: AtomRegistry.AtomRegistry,
): ViewRunner {
  const unmount = registry.mount(viewRuntime);
  // The registry is seeded with the services' Context, so the runtime atom
  // answers at once.
  const context = AsyncResult.getOrThrow(registry.get(viewRuntime));
  const { scope, close } = openScope();
  const fibers = Effect.runSyncWith(context)(
    FiberSet.make().pipe(Scope.provide(scope)),
  );
  const run = Effect.runSyncWith(context)(
    FiberSet.runtime(fibers)<ViewServices>(),
  );
  let closing: Promise<void> | null = null;
  const dispose = () => (closing ??= close().finally(unmount));
  return {
    run,
    provide: Effect.provideContext(context),
    settled: () => Effect.runPromiseWith(context)(FiberSet.awaitEmpty(fibers)),
    [Symbol.dispose]: () => void dispose(),
    [Symbol.asyncDispose]: dispose,
  };
}

/**
 * `effect` run on the view's runner and joined, for a caller outside the view,
 * such as a launch that opens the view. The view's close interrupts the run,
 * and so does the caller's own interrupt.
 */
export function joinOnView<A, E>(
  run: ViewRun,
  effect: Effect.Effect<A, E, ViewServices>,
): Effect.Effect<A, E> {
  return joinForked(Effect.sync(() => run(effect)));
}

/**
 * One run of a view flow at a time: a caller that comes while a run is in
 * flight joins that run and gets its answer, so a second press does the work
 * once. The view's close interrupts the run and every caller that joined it.
 */
export interface InFlightSlot<A, E> {
  /** Starts a run, or joins the one in flight. */
  readonly join: Effect.Effect<A, E>;
  /**
   * Starts a run unless one is in flight, for a gesture that waits for no
   * answer: the run reports its own outcome.
   */
  readonly start: () => void;
  /** Whether a run is in flight now. */
  readonly running: () => boolean;
}

/**
 * An {@link InFlightSlot} whose runs fork `effect` on `run`. `onChange` runs
 * when a run starts and when it ends, for a view that shows the run.
 */
export function inFlightSlot<A, E>(
  run: ViewRun,
  effect: Effect.Effect<A, E, ViewServices>,
  onChange: () => void = () => {},
): InFlightSlot<A, E> {
  let current: Fiber.Fiber<A, E> | null = null;
  const begin = (): Fiber.Fiber<A, E> => {
    if (current) return current;
    const fiber = run(effect);
    current = fiber;
    onChange();
    // A run that has ended already, as on a closed view, ends here at once.
    fiber.addObserver(() => {
      current = null;
      onChange();
    });
    return fiber;
  };
  return {
    join: Effect.suspend(() => Fiber.join(begin())),
    start: () => void begin(),
    running: () => current !== null,
  };
}

/**
 * One run at a time, the newest first: a new run interrupts the run before
 * it, so a superseded read stops in place of landing late. The view's close
 * interrupts the run as well.
 */
export interface LatestSlot<R> {
  /** Forks `effect` and interrupts the run before it. */
  readonly run: <A, E>(effect: Effect.Effect<A, E, R>) => Fiber.Fiber<A, E>;
  /**
   * Runs `effect` as {@link run} does and joins it, for a caller that waits
   * for the answer: `released` when a newer run or {@link interrupt} stops
   * it, or the view closes. The caller's interrupt interrupts the run.
   */
  readonly join: <A, E>(
    effect: Effect.Effect<A, E, R>,
    released: A,
  ) => Effect.Effect<A, E>;
  /** Interrupts the run in flight, for a change that makes its answer stale. */
  readonly interrupt: () => void;
}

/** A {@link LatestSlot} whose runs fork on `run`. */
export function latestSlot<R>(
  run: <A, E>(effect: Effect.Effect<A, E, R>) => Fiber.Fiber<A, E>,
): LatestSlot<R> {
  let current: Fiber.Fiber<unknown, unknown> | null = null;
  const interrupt = () => current?.interruptUnsafe();
  const start = <A, E>(effect: Effect.Effect<A, E, R>) => {
    interrupt();
    const fiber = run(effect);
    current = fiber;
    return fiber;
  };
  return {
    run: start,
    join: (effect, released) =>
      joinForked(Effect.sync(() => start(effect))).pipe(
        Effect.catchCauseIf(Cause.hasInterruptsOnly, () =>
          Effect.succeed(released),
        ),
      ),
    interrupt,
  };
}

/**
 * The value `fiber` succeeds with, for an Obsidian override or a plain caller
 * that answers a Promise: `released` when only interrupts ended the run (the
 * view closed, or a newer run superseded it), and the failure thrown
 * otherwise.
 */
export function answerOf<A, E>(
  fiber: Fiber.Fiber<A, E>,
  released: A,
): Promise<A> {
  return new Promise((resolve, reject) =>
    observeExit(fiber, {
      onSuccess: resolve,
      onInterrupt: () => resolve(released),
      onFailure: reject,
    }),
  );
}
