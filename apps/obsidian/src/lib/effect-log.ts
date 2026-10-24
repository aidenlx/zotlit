// The renderer's Effect-to-LogTape logging bridge.
import { getLogger as getLogTapeLogger } from "@logtape/logtape";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Logger from "effect/Logger";
import * as References from "effect/References";

import { setLibraryLogSink } from "@zotlit/shared/logging";

import { LogCategory, withLogCategory } from "./effect-log-category";
import { rootLogger } from "./log";

export { LogCategory, withLogCategory };

setLibraryLogSink(({ level, category, message, properties }) =>
  getLogTapeLogger(category)[level](message, properties),
);

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
    const logger =
      category[0] === "zotlit"
        ? getLogTapeLogger(category as [string, ...string[]])
        : category.length
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
