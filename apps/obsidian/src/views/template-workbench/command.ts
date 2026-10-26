// The Promise boundary required by the shared Workbench host, over leaf-owned commands.

import { Cause, Effect, Exit } from "effect";
import * as Atom from "effect/reactivity/Atom";

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
  const atom = viewRuntime.fn(
    (input: {
      value: I;
      resolve: (value: A) => void;
      reject: (error: unknown) => void;
    }) =>
      run(input.value).pipe(
        Effect.onExit((exit) =>
          Effect.sync(() => {
            if (Exit.isSuccess(exit)) input.resolve(exit.value);
            else input.reject(Cause.squash(exit.cause));
          }),
        ),
      ),
    options,
  );
  const release = registry.mount(atom);
  let closed = false;
  return {
    atom,
    run: (value: I): Promise<A> =>
      closed
        ? Promise.reject(new Error("Workbench command closed"))
        : new Promise((resolve, reject) =>
            registry.set(atom, { value, resolve, reject }),
          ),
    [Symbol.dispose]() {
      if (closed) return;
      closed = true;
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
