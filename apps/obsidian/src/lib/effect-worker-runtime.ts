import * as Context from "effect/Context";
import * as References from "effect/References";
// oxlint-disable-next-line no-restricted-imports -- The worker uses the shared Chromium scheduler below.
import { Scheduler } from "effect/Scheduler";

import { browserScheduler } from "./browser-scheduler";
import { makeRunSurface } from "./effect-runtime-factory";

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

export const {
  runFork,
  runForkWith,
  runCallback,
  runCallbackWith,
  runPromise,
  runPromiseWith,
  runPromiseExit,
  runPromiseExitWith,
  runSync,
  runSyncWith,
  runSyncExit,
  runSyncExitWith,
} = makeRunSurface(runtimeServices);
