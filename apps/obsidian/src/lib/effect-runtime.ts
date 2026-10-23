import * as Context from "effect/Context";
import * as NativeEffect from "effect/Effect";

import { runtimeServices } from "./effect-services";

export * from "effect/Effect";

// The caller's context wins over the runtime services it overrides.
const withRuntime = <R>(context: Context.Context<R>) =>
  Context.merge(runtimeServices, context);

export const runFork: typeof NativeEffect.runFork =
  NativeEffect.runForkWith(runtimeServices);
export const runForkWith: typeof NativeEffect.runForkWith = (context) =>
  NativeEffect.runForkWith(withRuntime(context));

export const runCallback: typeof NativeEffect.runCallback =
  NativeEffect.runCallbackWith(runtimeServices);
export const runCallbackWith: typeof NativeEffect.runCallbackWith = (context) =>
  NativeEffect.runCallbackWith(withRuntime(context));

export const runPromise: typeof NativeEffect.runPromise =
  NativeEffect.runPromiseWith(runtimeServices);
export const runPromiseWith: typeof NativeEffect.runPromiseWith = (context) =>
  NativeEffect.runPromiseWith(withRuntime(context));

export const runPromiseExit: typeof NativeEffect.runPromiseExit =
  NativeEffect.runPromiseExitWith(runtimeServices);
export const runPromiseExitWith: typeof NativeEffect.runPromiseExitWith = (
  context,
) => NativeEffect.runPromiseExitWith(withRuntime(context));

// runSync installs its own synchronous scheduler. Provide inside the effect
// so runtime factories and forked work capture the browser scheduler too.
const provideRuntime = <A, E, R>(
  effect: NativeEffect.Effect<A, E, R>,
  context?: Context.Context<R>,
) =>
  NativeEffect.provideContext(
    effect,
    withRuntime(context ?? (Context.empty() as Context.Context<R>)),
  );

export const runSync: typeof NativeEffect.runSync = (effect) =>
  NativeEffect.runSync(provideRuntime(effect));
export const runSyncWith: typeof NativeEffect.runSyncWith =
  (context) => (effect) =>
    NativeEffect.runSync(provideRuntime(effect, context));

export const runSyncExit: typeof NativeEffect.runSyncExit = (effect) =>
  NativeEffect.runSyncExit(provideRuntime(effect));
export const runSyncExitWith: typeof NativeEffect.runSyncExitWith =
  (context) => (effect) =>
    NativeEffect.runSyncExit(provideRuntime(effect, context));
