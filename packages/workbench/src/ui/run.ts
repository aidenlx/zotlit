// Where the tree starts host Effects: forked on the runner the host supplies,
// interrupted when the component that started one unmounts or asks again.
import { Cause, Effect, Exit, FiberSet, Scope } from "effect";
import type { Fiber } from "effect";
import { useEffect, useRef, useState } from "react";
import type { DependencyList } from "react";

/**
 * Forks an Effect and returns its Fiber: the runner `FiberSet.makeRuntime`
 * returns. Closing the Scope it was made on interrupts every Fiber it forked.
 */
export type WorkbenchRunner = <A, E>(
  effect: Effect.Effect<A, E>,
) => Fiber.Fiber<A, E>;

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
  const unobserve = fiber.addObserver((exit) => {
    if (Exit.isSuccess(exit)) handlers.onSuccess?.(exit.value);
    else if (!Cause.hasInterruptsOnly(exit.cause))
      handlers.onFailure?.(Cause.squash(exit.cause), exit.cause);
  });
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
  const [running] = useState(() => new Set<() => void>());
  useEffect(
    () => () => {
      for (const interrupt of running) interrupt();
      running.clear();
    },
    [running],
  );
  return (effect, handlers) => {
    if (run === undefined) return;
    // An Effect that ends before `run` returns reports first, so the entry
    // it removes is the one added below or none.
    let done = false;
    let interrupt: (() => void) | undefined;
    const settled = () => {
      done = true;
      if (interrupt) running.delete(interrupt);
    };
    interrupt = forkReported(run, effect, {
      onSuccess: (value) => {
        settled();
        handlers.onSuccess?.(value);
      },
      onFailure: (error, cause) => {
        settled();
        handlers.onFailure?.(error, cause);
      },
    });
    if (!done) running.add(interrupt);
  };
}

/**
 * A runner over a Scope of its own, for a host whose mount has no Effect
 * Scope to lend: the web page and the test host.
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
