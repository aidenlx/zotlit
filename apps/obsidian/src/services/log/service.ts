// LogTape's sinks and levels for the plugin, following the log settings.
import {
  configure,
  configureSync,
  getConsoleSink,
  reset,
} from "@logtape/logtape";
import type { Config, LogLevel, Sink } from "@logtape/logtape";
import type { Plugin } from "obsidian";

import { devToolsFormatter } from "@zotlit/shared/log-formatter";

import {
  Cause,
  Console,
  Context,
  Effect,
  Exit,
  Layer,
  Scope,
  Stream,
} from "@/lib/effect";
import { PluginSettings } from "@/services/settings/service";
import type { Settings } from "@/services/settings/service";

import { createVaultFileSink } from "./vault-sink";

export const LOG_FILENAME = "zotlit.log.jsonl";

type LogConfig = Config<string, string>;

/** What {@link layerLogging} drives: LogTape's configuration and the log file. */
export class LogOutput extends Context.Service<
  LogOutput,
  {
    /** Fails while an earlier configuration still holds an async sink. */
    configureSync(config: LogConfig): Effect.Effect<void, unknown>;
    configure(config: LogConfig): Effect.Effect<void, unknown>;
    readonly reset: Effect.Effect<void, unknown>;
    /** The plugin's log file, truncated; closing the scope drains it. */
    readonly openFile: Effect.Effect<Sink, unknown, Scope.Scope>;
  }
>()("zotlit/log/LogOutput") {}

/** LogTape itself, and the log file in the plugin's folder. */
export function layerLogOutput(
  plugin: Pick<Plugin, "app" | "manifest">,
): Layer.Layer<LogOutput> {
  const path = `${plugin.manifest.dir}/${LOG_FILENAME}`;
  const { adapter } = plugin.app.vault;
  return Layer.succeed(
    LogOutput,
    LogOutput.of({
      configureSync: (config) => Effect.try(() => configureSync(config)),
      configure: (config) => Effect.tryPromise(() => configure(config)),
      reset: Effect.tryPromise(() => reset()),
      openFile: Effect.acquireDisposable(
        Effect.tryPromise(() => createVaultFileSink(adapter, path)),
      ),
    }),
  );
}

interface LogSettings {
  readonly level: LogLevel | null;
  readonly toFile: boolean;
}

/** Until the log settings load, records go to the console. */
export const STARTUP_LOG_SETTINGS: LogSettings = {
  level: __DEV__ ? "debug" : "info",
  toFile: false,
};

/**
 * Configures LogTape when it builds, so every service built after it logs
 * from its first line, then applies each change to the log settings. While a
 * change applies, later changes wait and only the newest is applied; a change
 * that fails is applied again on the next settings change. A `null`
 * `log.level` routes `["zotlit"]` to no sinks and opens no file.
 *
 * Closing the layer waits for an applying change, drains the log file, and
 * resets LogTape. A failure is reported to the console through Effect's
 * `Console`, which does not depend on the LogTape configuration that failed.
 */
export const layerLogging: Layer.Layer<
  never,
  never,
  PluginSettings | LogOutput
> = Layer.effectDiscard(
  Effect.gen(function* () {
    const settings = yield* PluginSettings;
    const output = yield* LogOutput;

    yield* Effect.addFinalizer(() =>
      output.reset.pipe(reportFailure("Could not reset LogTape")),
    );
    yield* output
      .configureSync(logConfig(STARTUP_LOG_SETTINGS))
      .pipe(reportFailure("Could not configure startup logging"));

    // The open log file's scope, closed before the next file opens: a new
    // file truncates the same path.
    let fileScope = yield* Scope.make();
    yield* Effect.addFinalizer(() => Scope.close(fileScope, Exit.void));

    let applied: LogSettings | undefined;
    const apply = (next: LogSettings) =>
      Effect.gen(function* () {
        if (applied && sameLogSettings(applied, next)) return;
        yield* Scope.close(fileScope, Exit.void);
        fileScope = yield* Scope.make();
        const file =
          next.level !== null && next.toFile
            ? yield* output.openFile.pipe(Scope.provide(fileScope))
            : undefined;
        yield* output.configure(logConfig(next, file));
        applied = next;
      }).pipe(
        Effect.uninterruptible,
        reportFailure("Could not apply the log settings"),
      );

    yield* logSettingsChanges(settings).pipe(
      Stream.runForEach(apply),
      Effect.forkScoped,
    );
  }),
);

/** Report a failure of `effect` to the console and carry on. */
const reportFailure =
  (message: string) =>
  <E, R>(effect: Effect.Effect<void, E, R>): Effect.Effect<void, never, R> =>
    Effect.catchCause(effect, (cause) =>
      Console.error(message, Cause.squash(cause)),
    );

/**
 * The log settings once loaded, then on each settings change; a slow reader
 * sees only the newest.
 */
function logSettingsChanges(
  settings: PluginSettings["Service"],
): Stream.Stream<LogSettings> {
  return settings.changes.pipe(
    Stream.filter((value): value is Readonly<Settings> => value !== null),
    Stream.map(logSettingsOf),
    Stream.buffer({ capacity: 1, strategy: "sliding" }),
  );
}

function logSettingsOf(value: Readonly<Settings>): LogSettings {
  return { level: value["log.level"], toFile: value["log.to-file"] };
}

function sameLogSettings(a: LogSettings, b: LogSettings): boolean {
  return a.level === b.level && a.toFile === b.toFile;
}

function logConfig(settings: LogSettings, file?: Sink): LogConfig {
  const sinks = file ? ["console", "file"] : ["console"];
  return {
    reset: true,
    sinks: {
      console: getConsoleSink({ formatter: devToolsFormatter }),
      ...(file && { file }),
    },
    loggers: [
      {
        category: ["zotlit"],
        sinks: settings.level === null ? [] : sinks,
        lowestLevel: settings.level ?? "fatal",
      },
      { category: ["logtape", "meta"], sinks, lowestLevel: "warning" },
    ],
  };
}
