import type { WorkbenchRunner } from "#/language/host-effects";
// Where the tree starts host Effects: forked on the runner the host supplies,
// interrupted when the component that started one unmounts or asks again.
import { Effect, Exit, FiberSet, Scope } from "effect";
import type { Cause, Fiber } from "effect";
import { useEffect, useRef, useState } from "react";
import type { DependencyList } from "react";

import { observeExit } from "#/language/host-effects";

/** What a started Effect reports. An interrupt-only end reports nothing. */
export interface ForkHandlers<A, E> {
  readonly onSuccess?: (value: A) => void;
  readonly onFailure?: (error: unknown, cause: Cause.Cause<E>) => void;
}

/**
 * Forks `effect` on `run` and reports how it ended to `handlers`.
 * @returns Interrupts the Fiber; its end is no longer reported.
 */
export function forkReported<A, E>(
  run: WorkbenchRunner,
  effect: Effect.Effect<A, E>,
  handlers: ForkHandlers<A, E>,
): () => void {
  const fiber = run(effect);
  const unobserve = observeExit(fiber, handlers);
  return () => {
    unobserve();
    fiber.interruptUnsafe();
  };
}

export interface ForkedEffectOptions<A, E> extends ForkHandlers<A, E> {
  /** What `make` reads; a change starts the Effect again. */
  readonly deps: DependencyList;
}

/**
 * Starts the Effect `make` answers when the component mounts and each time
 * `deps` change; the change and the unmount interrupt the one before. `make`
 * answering `null` starts nothing.
 */
export function useForkedEffect<A, E>(
  run: WorkbenchRunner,
  make: () => Effect.Effect<A, E> | null,
  { deps, ...handlers }: ForkedEffectOptions<A, E>,
): void {
  const latest = useRef(handlers);
  latest.current = handlers;
  useEffect(() => {
    const effect = make();
    if (effect === null) return;
    return forkReported(run, effect, {
      onSuccess: (value) => latest.current.onSuccess?.(value),
      onFailure: (error, cause) => latest.current.onFailure?.(error, cause),
    });
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- `deps` name what `make` reads
  }, [run, ...deps]);
}

/**
 * A start function for Effects an event begins, such as a click. The
 * component's unmount interrupts every one still running. Outside a host,
 * with no runner, it starts nothing.
 */
export function useFork(
  run: WorkbenchRunner | undefined,
): <A, E>(effect: Effect.Effect<A, E>, handlers: ForkHandlers<A, E>) => void {
  const [running] = useState(() => new Set<Fiber.Fiber<unknown, unknown>>());
  useEffect(
    () => () => {
      for (const fiber of running) fiber.interruptUnsafe();
      running.clear();
    },
    [running],
  );
  return (effect, handlers) => {
    if (run === undefined) return;
    const fiber = run(effect);
    running.add(fiber);
    // A Fiber that has ended already leaves the set at once.
    fiber.addObserver(() => running.delete(fiber));
    observeExit(fiber, handlers);
  };
}

/**
 * A runner over a Scope of its own, for a host whose mount has no Effect
 * Scope to lend, such as the test host.
 */
export function makeWorkbenchRunner(): {
  readonly run: WorkbenchRunner;
  /** Interrupts every Effect `run` still runs. */
  readonly close: () => void;
} {
  const scope = Scope.makeUnsafe();
  const run = Effect.runSync(FiberSet.makeRuntime().pipe(Scope.provide(scope)));
  return {
    run,
    close: () => void Effect.runFork(Scope.close(scope, Exit.void)),
  };
}
