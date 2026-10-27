// The Promise boundary required by the shared Workbench host, over leaf-owned commands.

import { Cause, Effect, Exit } from "effect";
import type { Fiber } from "effect";
import * as Atom from "effect/reactivity/Atom";

import { AbortError } from "@/lib/abort-error";
import { viewRuntime } from "@/lib/view-atoms";
import type { ViewRegistryHandle, ViewServices } from "@/lib/view-atoms";

/**
 * A command stays mounted until its owner closes; interruption settles its
 * Promise. A new run interrupts the last one unless `concurrent`.
 */
export function makeWorkbenchCommand<I, A, E>(
  registry: ViewRegistryHandle,
  run: (input: I) => Effect.Effect<A, E, ViewServices>,
  options?: { readonly concurrent?: boolean },
) {
  let closed = false;
  const pending = new Set<Fiber.Fiber<unknown, unknown>>();
  const atom = viewRuntime.fn(
    (input: {
      value: I;
      resolve: (value: A) => void;
      reject: (error: unknown) => void;
    }) =>
      Effect.withFiber((fiber) => {
        pending.add(fiber);
        return (closed ? Effect.interrupt : run(input.value)).pipe(
          Effect.onExit((exit) =>
            Effect.sync(() => {
              pending.delete(fiber);
              if (Exit.isSuccess(exit)) input.resolve(exit.value);
              else
                input.reject(
                  Cause.hasInterruptsOnly(exit.cause)
                    ? new AbortError()
                    : Cause.squash(exit.cause),
                );
            }),
          ),
        );
      }),
    options,
  );
  const release = registry.mount(atom);
  return {
    atom,
    run: (value: I): Promise<A> =>
      closed
        ? Promise.reject(new AbortError("Workbench command closed"))
        : new Promise((resolve, reject) =>
            registry.set(atom, { value, resolve, reject }),
          ),
    [Symbol.dispose]() {
      if (closed) return;
      closed = true;
      // Concurrent atom runs are detached; interrupt them at this synchronous boundary.
      for (const fiber of pending) fiber.interruptUnsafe();
      registry.set(atom, Atom.Interrupt);
      release();
    },
  };
}

/** A command with no input; its result still belongs to its leaf. */
export function makeWorkbenchTask<A, E>(
  registry: ViewRegistryHandle,
  run: () => Effect.Effect<A, E, ViewServices>,
  options?: { readonly concurrent?: boolean },
) {
  return makeWorkbenchCommand<void, A, E>(registry, run, options);
}
