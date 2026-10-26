// Runners for entering Effect services from legacy classes and Promise code.
import { Cause, Context, Effect, Exit, Fiber, Scope } from "effect";
import type { ManagedRuntime, Stream } from "effect";

import { AbortError } from "./abort-error";
import { isScopeClosed } from "./effect-scope";
import { subscribe } from "./effect-stream";

/**
 * The one way legacy classes and Promise code run Effects on the plugin's
 * services.
 *
 * The runners are captured from the runtime context at build time: a disposed
 * runtime clears its context, while the captured context still answers with
 * the services' released values. `runPromise` and `runPromiseExit` run their
 * fibers in the runtime's scope, so unload interrupts every pending run.
 * `runPromiseExit` then resolves with an interrupt-only Exit: use it where a
 * closed runtime has its own answer. `runPromise` rejects with an
 * `AbortError`, which the toast and notifier helpers pass over.
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

/**
 * What a run settled to, for code that has no Effect to return it in: the
 * value of a success, `released` where only interrupts ended the run (the
 * runtime closed under it), and the failure thrown otherwise.
 */
export function valueOr<A, E>(exit: Exit.Exit<A, E>, released: A): A {
  if (Exit.isSuccess(exit)) return exit.value;
  if (Cause.hasInterruptsOnly(exit.cause)) return released;
  throw Cause.squash(exit.cause);
}

/**
 * The Exit runner an edge handle runs its Effects through: `bridge`'s
 * `runPromiseExit` over `context`. The handle maps the Exit to its caller's
 * answer, with {@link valueOr} or, where a signal cancels the run,
 * `settleAtEdge`.
 */
export function exitOver<R>(
  bridge: Pick<EffectBridge, "runPromiseExit">,
  context: Context.Context<R>,
) {
  return <A, E>(
    effect: Effect.Effect<A, E, R>,
    options?: { readonly signal?: AbortSignal },
  ): Promise<Exit.Exit<A, E>> =>
    bridge.runPromiseExit(Effect.provideContext(effect, context), options);
}

/** The runners over `context`, with pending runs and subscriptions kept in `scope`. */
function bridgeOver(
  context: Context.Context<never>,
  scope: Scope.Scope,
  host: Pick<ManagedRuntime.ManagedRuntime<never, never>, "runFork"> & {
    readonly scope: Scope.Scope;
  },
): EffectBridge {
  const runExit = Effect.runPromiseExitWith(context);
  const onFiberStart = Fiber.runIn(scope);
  const runPromiseExit: EffectBridge["runPromiseExit"] = (effect, options) =>
    runExit(effect, { ...options, onFiberStart });
  return {
    runSync: Effect.runSyncWith(context),
    runPromise: async (effect, options) => {
      const exit = await runPromiseExit(effect, options);
      if (Exit.isSuccess(exit)) return exit.value;
      if (Cause.hasInterruptsOnly(exit.cause))
        throw new AbortError("The plugin unloaded during the run.");
      throw Cause.squash(exit.cause);
    },
    runPromiseExit,
    subscribe: (stream, callback) => subscribe(host, stream, callback),
    closed: () => isScopeClosed(scope),
  };
}

export function effectBridge<R>(
  runtime: Pick<
    ManagedRuntime.ManagedRuntime<R, never>,
    "runSync" | "runFork" | "scope"
  >,
): EffectBridge {
  // Pending runs stay in the runtime's scope, so unload interrupts them.
  return bridgeOver(
    runtime.runSync(Effect.context<R>()),
    runtime.scope,
    runtime,
  );
}

/**
 * The bridge a layer hands to the plain code it owns, such as a state machine
 * kept as a class: the layer's own services, with pending runs and
 * subscriptions ended when the layer's Scope closes.
 */
export const scopedBridge: Effect.Effect<EffectBridge, never, Scope.Scope> =
  Effect.gen(function* () {
    const context = yield* Effect.context<Scope.Scope>();
    const scope = Context.get(context, Scope.Scope);
    return bridgeOver(context, scope, {
      runFork: Effect.runForkWith(context),
      scope,
    });
  });
