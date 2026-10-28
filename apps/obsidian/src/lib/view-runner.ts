// Where a view's plain code (an Obsidian callback, a menu item) forks Effect
// work on the view services for as long as the view stands.
//
// The runner forks each gesture on a FiberSet of the view's own and answers
// its Fiber, so the caller can interrupt or supersede that one gesture: an
// annotation insert that a cancelled drag stops, or an Item read that a newer
// selection replaces. Closing the view interrupts every fiber still running.
// What a component reads stays a view atom (ADR 0082).
import { RegistryContext } from "@effect/atom-react";
import { Effect, Exit, Fiber, FiberSet, Scope } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { useContext, useEffect, useState } from "react";

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
 * A runner over the view services of the root's registry, for a component
 * that mounts the Workbench UI itself. Unmounting the component interrupts
 * every Effect it still runs.
 */
export function useViewRunner(): ViewRun {
  const registry = useContext(RegistryContext);
  const [runner] = useState(() => makeViewRunner(registry));
  useEffect(() => () => runner[Symbol.dispose](), [runner]);
  return runner.run;
}

/** Call `answer` with the value `fiber` succeeds with; an interrupt calls nothing. */
export function onFiberSuccess<A, E>(
  fiber: Fiber.Fiber<A, E>,
  answer: (value: A) => void,
): void {
  fiber.addObserver((exit) => {
    if (Exit.isSuccess(exit)) answer(exit.value);
  });
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
  return Effect.suspend(() => {
    const fiber = run(effect);
    return Fiber.join(fiber).pipe(
      Effect.onInterrupt(() => Fiber.interrupt(fiber)),
    );
  });
}

/**
 * One run of a view flow at a time: a caller that comes while a run is in
 * flight joins that run and gets its answer, so a second press does the work
 * once. The view's close interrupts the run and every caller that joined it.
 */
export interface InFlightSlot<A, E> {
  /** Starts a run, or joins the one in flight. */
  readonly join: Effect.Effect<A, E>;
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
  return {
    join: Effect.suspend(() => {
      if (current) return Fiber.join(current);
      const fiber = run(effect);
      current = fiber;
      // A run that ended while it forked frees the slot at once.
      fiber.addObserver(() => {
        if (current !== fiber) return;
        current = null;
        onChange();
      });
      if (current === fiber) onChange();
      return Fiber.join(fiber);
    }),
    running: () => current !== null,
  };
}

/**
 * How `fiber` ended, for an Obsidian override that answers a Promise. An
 * interrupt-only Exit means the view closed or a newer run superseded it.
 */
export function exitOf<A, E>(
  fiber: Fiber.Fiber<A, E>,
): Promise<Exit.Exit<A, E>> {
  return new Promise((resolve) => fiber.addObserver(resolve));
}
