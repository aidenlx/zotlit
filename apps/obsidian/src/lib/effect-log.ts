// The renderer's Effect-to-LogTape logging bridge.
import { getLogger as getLogTapeLogger } from "@logtape/logtape";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Logger from "effect/Logger";
import * as References from "effect/References";

import { setLibraryLogSink } from "@zotlit/shared/logging";

import {
  LogCategory,
  LogTimestamp,
  withLogCategory,
} from "./effect-log-category";
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

/** The level names LogTape's `emit` takes, which differ from its methods. */
const LOG_TAPE_LEVELS = {
  Fatal: "fatal",
  Error: "error",
  Warn: "warning",
  Info: "info",
  Debug: "debug",
  Trace: "trace",
} as const;

/**
 * The LogTape message of `template` for a worker record the host re-emits:
 * its text and the property each `{key}` names, alternating, which is what
 * LogTape builds for a logged string. LogTape's `emit`, the only way to give a
 * record a timestamp, takes the message ready-made. `{{` and `}}` are literal
 * braces; a nested path such as `{a.b}` is not resolved. The plugin's own
 * records never come here: LogTape parses their templates.
 */
const renderTemplate = (
  template: string,
  properties: Readonly<Record<string, unknown>>,
): unknown[] => {
  const message: unknown[] = [];
  let text = "";
  for (let i = 0; i < template.length; i++) {
    const char = template[i]!;
    if ((char === "{" || char === "}") && template[i + 1] === char) {
      text += char;
      i++;
      continue;
    }
    const close = char === "{" ? template.indexOf("}", i + 1) : -1;
    if (close === -1) {
      text += char;
      continue;
    }
    const key = template.slice(i + 1, close);
    message.push(text, properties[key] ?? properties[key.trim()]);
    text = "";
    i = close;
  }
  message.push(text);
  return message;
};

/**
 * Writes each Effect log record to LogTape. The message's first part is the
 * LogTape message; annotations become its properties, beside the elapsed
 * milliseconds of each log span (`spans`), any further message parts
 * (`details`), and the failure of a logged cause (`error`). LogTape applies
 * the levels and sinks `layerLogging` configured. A record carrying a
 * `LogTimestamp`, which the host sets on a worker record it re-emits, goes
 * through LogTape's `emit` so it keeps the worker's time; every other record
 * goes through the logger's level method, which stamps it and parses its
 * template.
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
    const timestamp = fiber.getRef(LogTimestamp);
    if (timestamp !== undefined) {
      const level = LOG_TAPE_LEVELS[logLevel];
      if (!logger.isEnabledFor(level)) return;
      if (typeof text === "string")
        logger.emit({
          level,
          timestamp,
          rawMessage: text,
          message: renderTemplate(text, properties),
          properties,
        });
      else
        logger.emit({
          level,
          timestamp,
          rawMessage: "{message}",
          message: ["", text, ""],
          properties: { message: text, ...properties },
        });
    } else if (typeof text === "string")
      logger[METHODS[logLevel]](text, properties);
    else
      logger[METHODS[logLevel]]("{message}", { message: text, ...properties });
  },
);

/** What every `@/lib/effect` entry point runs with to log through LogTape. */
export const logServices = Context.make(
  Logger.CurrentLoggers,
  new Set([logTapeLogger]),
).pipe(Context.add(References.MinimumLogLevel, "All"));
