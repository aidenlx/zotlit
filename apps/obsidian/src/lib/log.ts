import { getLogger as tapGetLogger } from "@logtape/logtape";

/**
 * Root logger for the obsidian app. Module-level so any file can call
 * {@link getLogger} at import time without depending on the DI container.
 * `LoggingService` owns the `configure()` lifecycle; before it runs, calls
 * through this logger are no-ops aside from LogTape's own meta sink.
 */
export const rootLogger = tapGetLogger(["zotlit", "obsidian"]);

/**
 * Derive a logger under the obsidian root.
 * @param subcategory single string or non-empty array appended to `["zotlit", "obsidian"]`.
 */
export function getLogger(
  subcategory: string | readonly [string] | readonly [string, ...string[]],
) {
  return rootLogger.getChild(subcategory);
}
