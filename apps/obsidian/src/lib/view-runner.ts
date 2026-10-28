// Where a view's plain code (an Obsidian callback, a menu item) forks Effect
// work on the view services for as long as the view stands.
//
// A view runs most gestures as commands (ADR 0082). A command keeps one run
// per atom: the latest wins, or the run is held while the atom is mounted. A
// gesture that its caller must interrupt or supersede on its own, such as one
// annotation insert that a cancelled drag stops, needs its own fiber: the
// runner forks each gesture and answers its Fiber.
import { RegistryContext } from "@effect/atom-react";
import { Cause, Effect, Exit, FiberSet, Scope } from "effect";
import type { Fiber } from "effect";
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
  const run = Effect.runSyncWith(context)(
    FiberSet.makeRuntime<ViewServices>().pipe(Scope.provide(scope)),
  );
  let closing: Promise<void> | null = null;
  const dispose = () => (closing ??= close().finally(unmount));
  return {
    run,
    provide: Effect.provideContext(context),
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
 * How `fiber` ended, for a view flow that still awaits a Promise. An
 * interrupt-only Exit means the view closed or a newer run superseded it.
 */
export function exitOf<A, E>(
  fiber: Fiber.Fiber<A, E>,
): Promise<Exit.Exit<A, E>> {
  return new Promise((resolve) => fiber.addObserver(resolve));
}

/**
 * Runs `effect` once on the view services of `registry`, for plain code that
 * belongs to no open view. Its failure rejects.
 */
export async function runOnce<A, E>(
  registry: Parameters<typeof makeViewRunner>[0],
  effect: Effect.Effect<A, E, ViewServices>,
): Promise<A> {
  await using runner = makeViewRunner(registry);
  const exit = await exitOf(runner.run(effect));
  if (Exit.isSuccess(exit)) return exit.value;
  throw Cause.squash(exit.cause);
}
