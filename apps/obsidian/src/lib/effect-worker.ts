// Effect for worker entry points: Chromium scheduling without the renderer log bridge.
import * as Context from "effect/Context";
import * as NativeEffect from "effect/Effect";
import { Scheduler } from "effect/Scheduler";

import { browserScheduler } from "./browser-scheduler";

export * from "effect";

const workerServices = Context.make(Scheduler, browserScheduler);

export const runFork: typeof NativeEffect.runFork =
  NativeEffect.runForkWith(workerServices);
