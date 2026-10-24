import * as Context from "effect/Context";
// oxlint-disable-next-line no-restricted-imports -- Worker Effect excludes the renderer LogTape bridge.
import * as NativeEffect from "effect/Effect";
import * as References from "effect/References";
// oxlint-disable-next-line no-restricted-imports -- The worker uses the shared Chromium scheduler below.
import { Scheduler } from "effect/Scheduler";

import { browserScheduler } from "./browser-scheduler";

/**
 * Browser scheduling without the renderer's LogTape bridge. Every level
 * reaches the port logger, so the host's configured level is the only filter.
 */
const runtimeServices = Context.add(
  Context.empty(),
  Scheduler,
  browserScheduler,
).pipe(Context.add(References.MinimumLogLevel, "All"));

// oxlint-disable-next-line no-restricted-imports -- Re-export the worker-native Effect module.
export * from "effect/Effect";

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
