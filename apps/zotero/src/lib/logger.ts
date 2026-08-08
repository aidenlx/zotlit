import {
  configure,
  getLogger,
  getTextFormatter,
  isLogLevel,
  reset,
} from "@logtape/logtape";
import type { LogLevel, Sink, TextFormatter } from "@logtape/logtape";

import { MAIN_BUNDLE_NAME } from "@/constant";
import { prefs } from "@/prefs";

import { logToBrowserConsole } from "./zotero-log";

const LOG_SOURCE_NAME = `zotlit-${MAIN_BUNDLE_NAME}`;

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

function consoleLevelFromPref(pref: unknown): number {
  const level: LogLevel =
    typeof pref === "string" && isLogLevel(pref) ? pref : "warning";
  const rank = LOG_LEVELS[level];
  if (__DEV__) return Math.max(rank, LOG_LEVELS.debug);
  return rank;
}

let consoleLevel = LOG_LEVELS.warning;

function toConsole(text: string, level: LogLevel): void {
  if (level === "error" || level === "fatal") {
    logToBrowserConsole(text, "error", LOG_SOURCE_NAME);
  } else if (level === "warning") {
    logToBrowserConsole(text, "warning", LOG_SOURCE_NAME);
  } else {
    logToBrowserConsole(text, "info", LOG_SOURCE_NAME);
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
  consoleLevel = consoleLevelFromPref(
    prefs.get("extensions.zotlit.log.console-level"),
  );
  stack.defer(
    prefs.onChange("extensions.zotlit.log.console-level", (v) => {
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
