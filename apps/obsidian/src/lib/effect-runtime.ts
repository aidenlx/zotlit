import { makeRunSurface } from "./effect-runtime-factory";
import { runtimeServices } from "./effect-services";

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
