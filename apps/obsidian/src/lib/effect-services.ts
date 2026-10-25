// The services every Effect in Obsidian runs with: the plugin's entry points
// and its Effect tests add them alike.
import * as Context from "effect/Context";
import { Scheduler } from "effect/Scheduler";
import * as Tracer from "effect/Tracer";

import { browserScheduler } from "./browser-scheduler";
import { logServices } from "./effect-log";

/**
 * Browser scheduling, LogTape logging, and no trace context on the wire:
 * `HttpClient` adds a `traceparent` header to every request by default, and
 * neither Zotero nor a release host asks for one.
 */
export const runtimeServices = logServices.pipe(
  Context.add(Scheduler, browserScheduler),
  Context.add(Tracer.DisablePropagation, true),
);
