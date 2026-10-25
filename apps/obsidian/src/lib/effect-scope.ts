// Where Effect Scopes meet code that lives outside Effect: a service's load,
// a lease, a `Disposable` from Obsidian.
import type { Component } from "obsidian";

import { Cause, Effect, Exit, Scope } from "@/lib/effect";

import { withLogCategory } from "./effect-log";

/** Log a failed release, so the rest of the scope still closes. */
const logFailure =
  (message: string) =>
  <E, R>(release: Effect.Effect<void, E, R>): Effect.Effect<void, never, R> =>
    release.pipe(
      Effect.catchCause((cause) =>
        Effect.logError(message).pipe(
          Effect.annotateLogs({ error: Cause.squash(cause) }),
          withLogCategory("scope"),
        ),
      ),
    );

/**
 * Whether `scope` has closed: a released runtime or layer, which takes no new
 * work. Plain adapters check it before they run anything on their runtime.
 */
export function isScopeClosed(scope: Scope.Scope): boolean {
  return scope.state._tag === "Closed";
}

/**
 * A scope opened now, with the promise that closes it. Closing never fails: a
 * finalizer that fails is logged.
 */
export function openScope(): {
  scope: Scope.Closeable;
  close: () => Promise<void>;
} {
  const scope = Scope.makeUnsafe();
  return {
    scope,
    close: () =>
      Effect.runPromise(
        Scope.close(scope, Exit.void).pipe(
          logFailure("Could not close a scope"),
        ),
      ),
  };
}

/**
 * Finalizers run once: on unload, or earlier when the caller closes the Scope
 * itself. They run with the caller's services, and a failed one is logged
 * while the rest still run.
 *
 * @param component The edge (a view, a render child, a modal) whose unload
 *   closes the Scope.
 * @returns A Scope for the Effect work the edge holds while it stands.
 */
export function componentScope(
  component: Pick<Component, "register">,
): Effect.Effect<Scope.Closeable> {
  return Effect.gen(function* () {
    const scope = yield* Scope.make();
    const run = Effect.runPromiseWith(yield* Effect.context<never>());
    component.register(
      () =>
        void run(
          Scope.close(scope, Exit.void).pipe(
            logFailure("Could not close a scope"),
          ),
        ),
    );
    return scope;
  });
}
