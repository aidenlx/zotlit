import {
  configureSync,
  getConsoleSink,
  getLogger as tapGetLogger,
} from "@logtape/logtape";

/**
 * Root logger for the obsidian app. Module-level so any file can call
 * {@link getLogger} at import time without depending on the DI container.
 * `LoggingService` owns the `configure()` lifecycle; before it runs, calls
 * through this logger are no-ops aside from LogTape's own meta sink.
 */
export const rootLogger = tapGetLogger(["zotlit", "obsidian"]);

/**
 * Wires a console sink before `LoggingService` can read settings, so dev builds
 * keep startup records (locale resolution, Language Pack install) that would
 * otherwise be dropped. `LoggingService` replaces this config with `reset: true`.
 */
export function enableStartupLogging(): void {
  configureSync({
    sinks: { console: getConsoleSink() },
    loggers: [
      { category: ["zotlit"], sinks: ["console"], lowestLevel: "debug" },
      {
        category: ["logtape", "meta"],
        sinks: ["console"],
        lowestLevel: "warning",
      },
    ],
  });
}

/**
 * Derive a logger under the obsidian root.
 * @param subcategory single string or non-empty array appended to `["zotlit", "obsidian"]`.
 */
export function getLogger(
  subcategory: string | readonly [string] | readonly [string, ...string[]],
) {
  return rootLogger.getChild(subcategory);
}
