import {
  configure,
  configureSync,
  dispose,
  disposeSync,
  getConsoleSink,
  getLogger as tapGetLogger,
  reset,
} from "@logtape/logtape";
import type { Config } from "@logtape/logtape";

/**
 * Configure LogTape for the plugin. LogTape ties its disposal to the host
 * process with an `exit` (or `pagehide`) listener on every configure; in
 * Obsidian that process outlives the plugin, so the listener holds each
 * disabled plugin's bundle in memory (#1882). The plugin owns LogTape's
 * lifetime instead: `layerLogging` resets it on unload with
 * {@link resetLogTape}. Configure LogTape through these two functions only.
 */
export async function configureLogTape(
  config: Config<string, string>,
): Promise<void> {
  try {
    await configure(config);
  } finally {
    detachHostDisposeHook();
  }
}

/** {@link configureLogTape} for sync sinks. */
export function configureLogTapeSync(config: Config<string, string>): void {
  try {
    configureSync(config);
  } finally {
    detachHostDisposeHook();
  }
}

const LOGTAPE_ROOT = Symbol.for("logtape.rootLogger");

/**
 * Reset LogTape as the plugin unloads. LogTape keeps its root logger on
 * `globalThis` for every copy of it in the window, and that root is an
 * instance of the first bundle's class, so it holds that bundle in memory
 * after its unload (#1882). Releasing it lets the next load make its own.
 */
export async function resetLogTape(): Promise<void> {
  await reset();
  delete (globalThis as Record<symbol, unknown>)[LOGTAPE_ROOT];
}

/** Remove the listener LogTape's configure just added to the host. */
function detachHostDisposeHook(): void {
  for (const handler of [dispose, disposeSync]) {
    globalThis.process?.removeListener("exit", handler);
    globalThis.removeEventListener?.("pagehide", handler);
  }
}

/**
 * Root logger for the obsidian app. Module-level so any file can call
 * {@link getLogger} at import time without depending on the DI container.
 * `layerLogging` owns LogTape's configuration; before it builds, calls
 * through this logger are no-ops aside from LogTape's own meta sink.
 */
export const rootLogger = tapGetLogger(["zotlit", "obsidian"]);

/**
 * Wires a console sink before the services build, so dev builds keep startup
 * records (locale resolution, Language Pack install) that would otherwise be
 * dropped. `layerLogging` replaces this config with `reset: true`.
 */
export function enableStartupLogging(): void {
  configureLogTapeSync({
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
