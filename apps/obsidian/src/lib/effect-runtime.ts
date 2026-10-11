import * as Context from "effect/Context";
import * as NativeEffect from "effect/Effect";
import { Scheduler } from "effect/Scheduler";

import { browserScheduler } from "./browser-scheduler";

export * from "effect/Effect";

const services = Context.make(Scheduler, browserScheduler);

export const runFork: typeof NativeEffect.runFork =
  NativeEffect.runForkWith(services);
export const runForkWith: typeof NativeEffect.runForkWith = (context) =>
  NativeEffect.runForkWith(Context.add(context, Scheduler, browserScheduler));

export const runCallback: typeof NativeEffect.runCallback =
  NativeEffect.runCallbackWith(services);
export const runCallbackWith: typeof NativeEffect.runCallbackWith = (context) =>
  NativeEffect.runCallbackWith(
    Context.add(context, Scheduler, browserScheduler),
  );

export const runPromise: typeof NativeEffect.runPromise =
  NativeEffect.runPromiseWith(services);
export const runPromiseWith: typeof NativeEffect.runPromiseWith = (context) =>
  NativeEffect.runPromiseWith(
    Context.add(context, Scheduler, browserScheduler),
  );

export const runPromiseExit: typeof NativeEffect.runPromiseExit =
  NativeEffect.runPromiseExitWith(services);
export const runPromiseExitWith: typeof NativeEffect.runPromiseExitWith = (
  context,
) =>
  NativeEffect.runPromiseExitWith(
    Context.add(context, Scheduler, browserScheduler),
  );

// runSync installs its own synchronous scheduler. Provide inside the effect
// so runtime factories and forked work capture the browser scheduler too.
export const runSync: typeof NativeEffect.runSync = (effect) =>
  NativeEffect.runSync(
    NativeEffect.provideService(effect, Scheduler, browserScheduler),
  );
export const runSyncWith: typeof NativeEffect.runSyncWith =
  (context) => (effect) =>
    NativeEffect.runSyncWith(context)(
      NativeEffect.provideService(effect, Scheduler, browserScheduler),
    );

export const runSyncExit: typeof NativeEffect.runSyncExit = (effect) =>
  NativeEffect.runSyncExit(
    NativeEffect.provideService(effect, Scheduler, browserScheduler),
  );
export const runSyncExitWith: typeof NativeEffect.runSyncExitWith =
  (context) => (effect) =>
    NativeEffect.runSyncExitWith(context)(
      NativeEffect.provideService(effect, Scheduler, browserScheduler),
    );
