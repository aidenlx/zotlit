import { it } from "@effect/vitest";
import type { Config } from "@logtape/logtape";
import { Effect, Exit, Fiber, Layer, Queue, Schema, Scope } from "effect";
import { TestClock, TestConsole } from "effect/testing";
import type { Plugin } from "obsidian";
import { expect } from "vitest";

import { settingsOf } from "@/services/settings/__fixtures__";
import { settingsMigrations } from "@/services/settings/migrate";
import { PluginSettings } from "@/services/settings/service";

import { layerLogging, LogOutput, STARTUP_LOG_SETTINGS } from "./service";

/** The failure the fake LogTape answers a configure with. */
class ConfigureFailed extends Schema.TaggedError<
  ConfigureFailed,
  { readonly brand: unique symbol }
>()("ConfigureFailed", { message: Schema.String }) {}

type LogConfig = Config<string, string>;

/**
 * Each `configure` LogTape is asked for takes one second of the TestClock. A
 * case lets the last one finish: closing waits for a change being applied.
 */
const CONFIGURE_TIME = "1 second";

/**
 * The logging layer over saved settings `saved` (still loading when omitted),
 * driving a fake LogTape that records what happens in `events`.
 */
const logging = Effect.fnUntraced(function* (
  saved: Record<string, unknown> = {},
  options: { failFirstConfigure?: boolean } = {},
) {
  const events: string[] = [];
  const configs: LogConfig[] = [];
  const started = yield* Queue.unbounded<LogConfig>();
  let failNext = options.failFirstConfigure ?? false;
  const output = LogOutput.of({
    configureSync: (config) =>
      Effect.sync(() => {
        events.push("configureSync");
        configs.push(config);
      }),
    configure: (config) =>
      Effect.gen(function* () {
        events.push("configure");
        yield* Queue.offer(started, config);
        yield* Effect.sleep(CONFIGURE_TIME);
        if (failNext) {
          failNext = false;
          return yield* new ConfigureFailed({ message: "boom" });
        }
        events.push("configured");
        configs.push(config);
      }),
    reset: Effect.sync(() => {
      events.push("reset");
    }),
    openFile: Effect.acquireRelease(
      Effect.sync(() => {
        events.push("open file");
        return () => {};
      }),
      () => Effect.sync(() => events.push("close file")),
    ),
  });
  const plugin = {
    loadData: async () => ({ __VERSION__: 11, ...saved }),
    saveData: async () => {},
  } as unknown as Plugin;
  const settings = yield* settingsOf({ plugin, ...settingsMigrations });
  const layer = layerLogging.pipe(
    Layer.provide(Layer.succeed(LogOutput, output)),
    Layer.provide(Layer.succeed(PluginSettings, settings)),
  );
  return { layer, settings, events, configs, started };
});

/** The level LogTape routes ZotLit records at under `config`. */
const zotlitLogger = (config: LogConfig) =>
  config.loggers.find((logger) => logger.category[0] === "zotlit")!;

// Failure mode: a service built after logging drops its startup records,
// because LogTape has no sinks until the settings load.
it.effect("logs to the console as soon as it builds", () =>
  Effect.gen(function* () {
    const { layer, events, configs, started } = yield* logging();
    yield* Layer.build(layer);

    expect(events).toEqual(["configureSync"]);
    expect(zotlitLogger(configs[0]!)).toMatchObject({
      sinks: ["console"],
      lowestLevel: STARTUP_LOG_SETTINGS.level,
    });
    yield* Queue.take(started);
    yield* TestClock.adjust(CONFIGURE_TIME);
  }),
);

// Failure modes: a changed level never reaches LogTape, or the log file stays
// open, undrained, after it is turned off.
it.effect("applies each change, closing the log file it turns off", () =>
  Effect.gen(function* () {
    const { layer, settings, events, started } = yield* logging({
      "log.level": "debug",
      "log.to-file": true,
    });
    yield* Layer.build(layer);

    expect(zotlitLogger(yield* Queue.take(started))).toMatchObject({
      sinks: ["console", "file"],
      lowestLevel: "debug",
    });
    yield* TestClock.adjust(CONFIGURE_TIME);

    yield* settings.update({ "log.to-file": false });
    expect(zotlitLogger(yield* Queue.take(started)).sinks).toEqual(["console"]);
    yield* TestClock.adjust(CONFIGURE_TIME);

    expect(events).toEqual([
      "configureSync",
      "open file",
      "configure",
      "configured",
      "close file",
      "configure",
      "configured",
    ]);
  }),
);

// Failure mode: logging turned off still writes ZotLit records, or opens
// the log file.
it.effect("routes nothing and opens no file when log.level is null", () =>
  Effect.gen(function* () {
    const { layer, events, started } = yield* logging({
      "log.level": null,
      "log.to-file": true,
    });
    yield* Layer.build(layer);

    expect(zotlitLogger(yield* Queue.take(started)).sinks).toEqual([]);
    yield* TestClock.adjust(CONFIGURE_TIME);
    expect(events).not.toContain("open file");
  }),
);

// Failure mode: rapid changes are applied one by one, so the newest waits
// behind every change before it.
it.effect("applies only the newest of the changes made while one applies", () =>
  Effect.gen(function* () {
    const { layer, settings, started } = yield* logging({
      "log.level": "info",
    });
    yield* Layer.build(layer);
    yield* Queue.take(started);

    yield* settings.update({ "log.level": "debug" });
    yield* settings.update({ "log.level": "warning" });
    yield* settings.update({ "log.level": "error" });
    yield* TestClock.adjust(CONFIGURE_TIME);

    expect(zotlitLogger(yield* Queue.take(started)).lowestLevel).toBe("error");
    yield* TestClock.adjust(CONFIGURE_TIME);
  }),
);

// Failure mode: unload resets LogTape while a change still applies, and that
// change then installs sinks nobody closes.
it.effect("closes after the change it is applying, then resets LogTape", () =>
  Effect.gen(function* () {
    const { layer, events, started } = yield* logging({
      "log.to-file": true,
    });
    const scope = yield* Scope.make();
    yield* Layer.buildWithScope(layer, scope);
    yield* Queue.take(started);

    const closing = yield* Effect.forkChild(Scope.close(scope, Exit.void), {
      startImmediately: true,
    });
    yield* TestClock.adjust(CONFIGURE_TIME);
    yield* Fiber.join(closing);

    expect(events.slice(-3)).toEqual(["configured", "close file", "reset"]);
  }),
);

// Failure modes: a failed change goes unreported when ZotLit's own logging
// is what failed, or is never applied again.
it.effect("reports a change it cannot apply and applies it again later", () =>
  Effect.gen(function* () {
    const { layer, settings, started } = yield* logging(
      { "log.level": "debug" },
      { failFirstConfigure: true },
    );
    yield* Layer.build(layer);
    yield* Queue.take(started);
    yield* TestClock.adjust(CONFIGURE_TIME);

    expect(yield* TestConsole.errorLines).toEqual([
      "Could not apply the log settings",
      new ConfigureFailed({ message: "boom" }),
    ]);

    yield* settings.update({ "citation.editor-suggester": false });
    expect(zotlitLogger(yield* Queue.take(started)).lowestLevel).toBe("debug");
    yield* TestClock.adjust(CONFIGURE_TIME);
  }),
);
