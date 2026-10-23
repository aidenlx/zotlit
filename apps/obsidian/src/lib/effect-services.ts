// The services every Effect in Obsidian runs with: the plugin's entry points
// and its Effect tests add them alike.
import * as Context from "effect/Context";
import { Scheduler } from "effect/Scheduler";

import { browserScheduler } from "./browser-scheduler";
import { logServices } from "./effect-log";

/** Browser scheduling and LogTape logging. */
export const runtimeServices = Context.add(
  logServices,
  Scheduler,
  browserScheduler,
);
