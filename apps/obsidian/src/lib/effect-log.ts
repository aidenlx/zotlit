// The renderer's Effect-to-LogTape logging bridge.
import { getLogger as getLogTapeLogger } from "@logtape/logtape";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Logger from "effect/Logger";
import * as References from "effect/References";

import { setLibraryLogSink } from "@zotlit/shared/logging";

import type { EffectBridge } from "./effect-bridge";
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

/** What every renderer Effect entry point runs with to log through LogTape. */
export const logServices = Context.make(
  Logger.CurrentLoggers,
  new Set([logTapeLogger]),
).pipe(Context.add(References.MinimumLogLevel, "All"));

/**
 * The failure boundary of a consumer that outlives one bad element: log the
 * cause under `category`, with `annotations` on that record, and carry on.
 * Interruption passes through, so shutdown still stops the consumer.
 */
export const logAndContinue =
  (
    message: string,
    category: string,
    annotations?: Readonly<Record<string, unknown>>,
  ) =>
  <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A | void, never, R> =>
    effect.pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) return Effect.interrupt;
        const logged = Effect.logError(message, cause);
        return (
          annotations ? Effect.annotateLogs(logged, annotations) : logged
        ).pipe(withLogCategory(category));
      }),
    );

/** One level's log call for plain code: the message and the fields it carries. */
type BridgeLogMethod = (
  message: string,
  fields?: Readonly<Record<string, unknown>>,
) => void;

/**
 * The log calls of plain code that holds a bridge, written under `category`
 * through the bridge's runtime so they reach the plugin's loggers.
 */
export function bridgeLog(
  bridge: Pick<EffectBridge, "runSync">,
  category: string,
): Record<"trace" | "debug" | "info" | "warn" | "error", BridgeLogMethod> {
  const at =
    (log: (message: string) => Effect.Effect<void>): BridgeLogMethod =>
    (message, fields) => {
      const record = log(message);
      bridge.runSync(
        (fields ? Effect.annotateLogs(record, fields) : record).pipe(
          withLogCategory(category),
        ),
      );
    };
  return {
    trace: at(Effect.logTrace),
    debug: at(Effect.logDebug),
    info: at(Effect.logInfo),
    warn: at(Effect.logWarning),
    error: at(Effect.logError),
  };
}
