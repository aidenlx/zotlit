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
  const scope = Effect.runSync(Scope.make());
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
 * A Scope that closes when `component` unloads, for Effect work an edge (a
 * view, a render child, a modal) holds while it stands. Its finalizers run
 * once: on unload, or earlier when the caller closes the Scope itself. A
 * failed finalizer is logged, and the rest still run.
 */
export function componentScope(
  component: Pick<Component, "register">,
): Effect.Effect<Scope.Closeable> {
  return Effect.sync(() => {
    const { scope, close } = openScope();
    component.register(() => void close());
    return scope;
  });
}

/**
 * Acquire a `Disposable` for the current scope; closing the scope disposes
 * it, and a failed disposal is logged.
 */
export function acquireDisposable<D extends Disposable>(
  acquire: () => D,
): Effect.Effect<D, never, Scope.Scope> {
  return Effect.acquireRelease(Effect.sync(acquire), (disposable) =>
    Effect.try(() => disposable[Symbol.dispose]()).pipe(
      logFailure("Could not release a resource"),
    ),
  );
}

/**
 * Acquire an `AsyncDisposable` for the current scope; closing the scope
 * awaits its disposal, and a failed disposal is logged. A rejected `acquire`
 * fails with `UnknownError`.
 */
export function acquireAsyncDisposable<D extends AsyncDisposable>(
  acquire: () => Promise<D>,
): Effect.Effect<D, Cause.UnknownError, Scope.Scope> {
  return Effect.acquireRelease(Effect.tryPromise(acquire), (disposable) =>
    Effect.tryPromise(() => disposable[Symbol.asyncDispose]()).pipe(
      logFailure("Could not release a resource"),
    ),
  );
}
