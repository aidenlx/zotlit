// Effect is the plugin's logging API; its records reach the LogTape sinks
// `layerLogging` configures.
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as NativeEffect from "effect/Effect";
import * as Logger from "effect/Logger";
import * as References from "effect/References";

import { rootLogger } from "./log";

/** The category under `["zotlit", "obsidian"]` an Effect's logs are filed under. */
export const LogCategory = Context.Reference<readonly string[]>(
  "zotlit/effect-log/LogCategory",
  { defaultValue: () => [] },
);

/** File the logs of an Effect under `category`, below `["zotlit", "obsidian"]`. */
export const withLogCategory =
  (...category: [string, ...string[]]) =>
  <A, E, R>(self: NativeEffect.Effect<A, E, R>): NativeEffect.Effect<A, E, R> =>
    NativeEffect.provideService(self, LogCategory, category);

const METHODS = {
  Fatal: "fatal",
  Error: "error",
  Warn: "warn",
  Info: "info",
  Debug: "debug",
  Trace: "trace",
} as const;

/**
 * Writes each Effect log record to LogTape. The message's first part is the
 * LogTape message; annotations become its properties, beside the elapsed
 * milliseconds of each log span (`spans`), any further message parts
 * (`details`), and the failure of a logged cause (`error`). LogTape applies
 * the levels and sinks `layerLogging` configured.
 */
export const logTapeLogger = Logger.make<unknown, void>(
  ({ message, logLevel, cause, fiber, date }) => {
    if (logLevel === "All" || logLevel === "None") return;
    const category = fiber.getRef(LogCategory);
    const logger = category.length
      ? rootLogger.getChild(category as [string, ...string[]])
      : rootLogger;
    const [text, ...details] = Array.isArray(message) ? message : [message];
    const properties: Record<string, unknown> = {
      ...fiber.getRef(References.CurrentLogAnnotations),
    };
    const spans = fiber.getRef(References.CurrentLogSpans);
    if (spans.length > 0)
      properties["spans"] = Object.fromEntries(
        spans.map(([label, start]) => [label, date.getTime() - start]),
      );
    if (details.length > 0) properties["details"] = details;
    if (cause.reasons.length > 0) properties["error"] = Cause.squash(cause);
    if (typeof text === "string") logger[METHODS[logLevel]](text, properties);
    else
      logger[METHODS[logLevel]]("{message}", { message: text, ...properties });
  },
);

/** What every `@/lib/effect` entry point runs with to log through LogTape. */
export const logServices = Context.make(
  Logger.CurrentLoggers,
  new Set([logTapeLogger]),
).pipe(Context.add(References.MinimumLogLevel, "All"));
