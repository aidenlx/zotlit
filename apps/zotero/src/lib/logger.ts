import {
  configure,
  getLogger,
  getTextFormatter,
  reset,
  type LogLevel,
  type Sink,
  type TextFormatter,
} from "@logtape/logtape";
import { prefs } from "../prefs";
import { logToBrowserConsole } from "./zotero-log";

const LOG_LEVELS: Record<LogLevel, number> = {
  trace: 6,
  debug: 5,
  info: 4,
  warning: 3,
  error: 2,
  fatal: 1,
};

const ZOTERO_DEBUG_LEVELS: Record<LogLevel, number> = {
  trace: 5,
  debug: 4,
  info: 3,
  warning: 2,
  error: 1,
  fatal: 1,
};

function errorReplacer(_key: string, value: unknown): unknown {
  if (!(value instanceof Error)) return value;
  const out: Record<string, unknown> = {
    name: value.name,
    message: value.message,
    stack: value.stack,
  };
  const cause = (value as { cause?: unknown }).cause;
  if (cause !== undefined) out.cause = cause;
  return out;
}

const formatRecord: TextFormatter = getTextFormatter({
  timestamp: "time",
  format({ timestamp, level, category, message, record }) {
    const head = `${timestamp ? `${timestamp} ` : ""}[${level}] ${category}: ${message}`;
    for (const _ in record.properties) {
      return `${head} ${JSON.stringify(record.properties, errorReplacer)}`;
    }
    return head;
  },
});

function consoleLevelFromPref(pref: string): number {
  const rank = LOG_LEVELS[pref as LogLevel] ?? LOG_LEVELS.warning;
  if (__DEV__) return Math.max(rank, LOG_LEVELS.debug);
  return rank;
}

let consoleLevel = LOG_LEVELS.warning;

function toConsole(text: string, level: LogLevel): void {
  if (level === "error" || level === "fatal") {
    logToBrowserConsole(text, "error", "zotlit-main.js");
  } else if (level === "warning") {
    logToBrowserConsole(text, "warning", "zotlit-main.js");
  } else {
    logToBrowserConsole(text, "info", "zotlit-main.js");
  }
}

const zoteroSink: Sink = (record) => {
  const text = formatRecord(record).trimEnd();
  Zotero.debug(text, ZOTERO_DEBUG_LEVELS[record.level]);
  if (LOG_LEVELS[record.level] <= consoleLevel) {
    toConsole(text, record.level);
  }
};

/** Call once during plugin startup. Dispose the return value to tear down. */
export async function setupLogging(): Promise<AsyncDisposable> {
  await using stack = new AsyncDisposableStack();
  consoleLevel = consoleLevelFromPref(prefs.get("log.console-level"));
  stack.defer(
    prefs.onChange("log.console-level", (v) => {
      consoleLevel = consoleLevelFromPref(v);
    }),
  );

  await configure({
    sinks: { zotero: zoteroSink },
    loggers: [
      {
        category: "zotlit",
        lowestLevel: "debug",
        sinks: ["zotero"],
      },
      {
        category: ["logtape", "meta"],
        lowestLevel: "warning",
        sinks: ["zotero"],
      },
    ],
  });
  stack.defer(reset);
  return stack.move();
}

export const logger = getLogger(["zotlit", "zotero"]);
