// Runners for entering Effect services from legacy classes and Promise code.
import { Context, Effect, Fiber, Scope } from "@/lib/effect";
import type { Exit, ManagedRuntime, Stream } from "@/lib/effect";

import { isScopeClosed } from "./effect-scope";
import { subscribe } from "./effect-stream";

/**
 * The one way legacy classes and Promise code run Effects on the plugin's
 * services.
 *
 * The runners are captured from the runtime context at build time: a disposed
 * runtime clears its context, while the captured context still answers with
 * the services' released values. `runPromiseExit` alone runs its fiber in the
 * runtime's scope, so unload interrupts a pending run and the caller sees an
 * interrupt-only Exit: use it where a closed runtime has its own answer.
 */
export interface EffectBridge {
  readonly runSync: <A, E>(effect: Effect.Effect<A, E>) => A;
  readonly runPromise: <A, E>(
    effect: Effect.Effect<A, E>,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<A>;
  readonly runPromiseExit: <A, E>(
    effect: Effect.Effect<A, E>,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<Exit.Exit<A, E>>;
  readonly subscribe: <A>(
    stream: Stream.Stream<A>,
    callback: (value: A) => void,
  ) => () => void;
  readonly closed: () => boolean;
}

export function effectBridge<R>(
  runtime: ManagedRuntime.ManagedRuntime<R, never>,
): EffectBridge {
  const context = runtime.runSync(Effect.context<R>());
  const runPromiseExit = Effect.runPromiseExitWith(context);
  // Keep pending Exit runs in the runtime's scope, so unload interrupts them.
  const onFiberStart = Fiber.runIn(runtime.scope);
  return {
    runSync: Effect.runSyncWith(context),
    runPromise: Effect.runPromiseWith(context),
    runPromiseExit: (effect, options) =>
      runPromiseExit(effect, {
        ...options,
        onFiberStart,
      }),
    subscribe: (stream, callback) => subscribe(runtime, stream, callback),
    closed: () => isScopeClosed(runtime.scope),
  };
}

/**
 * The bridge a layer hands to the plain code it owns, such as a state machine
 * kept as a class: the layer's own services, with pending Exit runs and
 * subscriptions ended when the layer's Scope closes.
 */
export const scopedBridge: Effect.Effect<EffectBridge, never, Scope.Scope> =
  Effect.gen(function* () {
    const context = yield* Effect.context<Scope.Scope>();
    const scope = Context.get(context, Scope.Scope);
    const runPromiseExit = Effect.runPromiseExitWith(context);
    const onFiberStart = Fiber.runIn(scope);
    const host = { runFork: Effect.runForkWith(context), scope };
    return {
      runSync: Effect.runSyncWith(context),
      runPromise: Effect.runPromiseWith(context),
      runPromiseExit: (effect, options) =>
        runPromiseExit(effect, { ...options, onFiberStart }),
      subscribe: (stream, callback) => subscribe(host, stream, callback),
      closed: () => isScopeClosed(scope),
    };
  });
