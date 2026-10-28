// Where a view's plain code (an Obsidian callback, a menu item) forks Effect
// work on the view services for as long as the view stands.
import { RegistryContext } from "@effect/atom-react";
import { Effect, FiberSet, Scope } from "effect";
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

export interface ViewRunner extends Disposable {
  readonly run: ViewRun;
}

/**
 * A runner over the view services of `registry`, for one view. Its fibers sit
 * in a `FiberSet` on a Scope of the view's own; disposing the runner closes
 * that Scope, which interrupts every fiber still running.
 */
export function makeViewRunner(
  registry: AtomRegistry.AtomRegistry,
): ViewRunner {
  const unmount = registry.mount(viewRuntime);
  const context = registry.get(viewRuntime);
  if (!AsyncResult.isSuccess(context)) {
    unmount();
    throw new Error("The view services are not ready on this registry");
  }
  const { scope, close } = openScope();
  const run = Effect.runSyncWith(context.value)(
    FiberSet.makeRuntime<ViewServices>().pipe(Scope.provide(scope)),
  );
  return {
    run,
    [Symbol.dispose]() {
      void close().finally(unmount);
    },
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
