import { type LogRecord, type Sink } from "@logtape/logtape";
import { type DataAdapter, type Plugin } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { migrateLegacyV0, migrateV1ToV2 } from "@/services/settings/migrate";
import { SettingsService } from "@/services/settings/service";

import { LoggingService } from "./service";

vi.mock("@logtape/logtape", async (importOriginal) => {
  const real = await importOriginal<typeof import("@logtape/logtape")>();
  return {
    ...real,
    configure: vi.fn().mockResolvedValue(undefined),
  };
});

import { configure } from "@logtape/logtape";

const configureMock = vi.mocked(configure);

interface PluginStubData {
  __data: unknown;
}

function makePluginStub(initial: unknown = null) {
  const data: PluginStubData = { __data: initial };

  const write = vi.fn(async (_path: string, _content: string) => undefined);
  const append = vi.fn(async (_path: string, _content: string) => undefined);
  const adapter = { write, append } as unknown as DataAdapter;

  const plugin = {
    app: { vault: { adapter } },
    manifest: { dir: ".obsidian/plugins/zotlit" },
    async loadData() {
      return data.__data;
    },
    async saveData(payload: unknown) {
      data.__data = payload;
    },
  } as unknown as Pick<Plugin, "app" | "manifest" | "loadData" | "saveData">;

  return { plugin, adapter, write, append };
}

async function makeLogging(initial: Record<string, unknown> | null = null) {
  const stub = makePluginStub(
    initial === null ? null : { __VERSION__: 1, ...initial },
  );
  const settings = new SettingsService({
    plugin: stub.plugin,
    migrateLegacy: migrateLegacyV0,
    migrateV1: migrateV1ToV2,
  });
  const logging = new LoggingService({ plugin: stub.plugin, settings });
  await logging.ready;
  return {
    ...stub,
    settings,
    logging,
    [Symbol.asyncDispose]: () => logging[Symbol.asyncDispose](),
  };
}

/**
 * Drain the microtask queue several times so chained `await`s in
 * `LoggingService.#flushDesired` and its `applyConfig` body all settle.
 * Reconfigure goes through multiple awaits (dispose, create-sink, configure)
 * so a single `await Promise.resolve()` doesn't catch up to the loop exit.
 * 50 iterations is generous; the actual depth is ~6 per `applyConfig`.
 */
async function flushAll(): Promise<void> {
  for (let i = 0; i < 50; i++) {
    await Promise.resolve();
  }
}

function makeRecord(message: string): LogRecord {
  return {
    category: ["zotlit", "obsidian", "test"],
    level: "info",
    message: [message],
    properties: {},
    rawMessage: message,
    timestamp: 1_700_000_000_000,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  configureMock.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("LoggingService", () => {
  it("configures with the initial settings (level=info, file off)", async () => {
    await using _ = await makeLogging({
      "log.level": "info",
      "log.to-file": false,
    });

    expect(configureMock).toHaveBeenCalledTimes(1);
    const config = configureMock.mock.calls[0]![0]! as {
      sinks: Record<string, unknown>;
      loggers: Array<{
        category: readonly string[];
        sinks: readonly string[];
        lowestLevel: string;
      }>;
    };
    expect(Object.keys(config.sinks)).toEqual(["console"]);
    expect(config.loggers[0]).toMatchObject({
      category: ["zotlit"],
      sinks: ["console"],
      lowestLevel: "info",
    });
    expect(config.loggers[1]).toMatchObject({
      category: ["logtape", "meta"],
      sinks: ["console"],
      lowestLevel: "warning",
    });
  });

  it("opens the vault file sink when log.to-file is true", async () => {
    await using harness = await makeLogging({
      "log.level": "debug",
      "log.to-file": true,
    });
    const { write } = harness;

    expect(write).toHaveBeenCalledWith(
      ".obsidian/plugins/zotlit/zotlit.log.jsonl",
      "",
    );
    const config = configureMock.mock.calls[0]![0]! as {
      sinks: Record<string, unknown>;
      loggers: Array<{ sinks: readonly string[] }>;
    };
    expect(Object.keys(config.sinks).sort()).toEqual(["console", "file"]);
    expect(config.loggers[0]!.sinks).toEqual(["console", "file"]);
    expect(config.loggers[1]!.sinks).toEqual(["console", "file"]);
  });

  it("uses empty zotlit sinks when log.level is null", async () => {
    await using harness = await makeLogging({
      "log.level": null,
      "log.to-file": true,
    });
    const { write } = harness;

    expect(write).not.toHaveBeenCalled();
    const config = configureMock.mock.calls[0]![0]! as {
      sinks: Record<string, unknown>;
      loggers: Array<{ category: readonly string[]; sinks: readonly string[] }>;
    };
    expect(Object.keys(config.sinks)).toEqual(["console"]);
    expect(config.loggers[0]).toMatchObject({
      category: ["zotlit"],
      sinks: [],
    });
    expect(config.loggers[1]!.sinks).toEqual(["console"]);
  });

  it("reconfigures when log.level changes", async () => {
    await using harness = await makeLogging({
      "log.level": "info",
      "log.to-file": false,
    });
    const { settings } = harness;
    expect(configureMock).toHaveBeenCalledTimes(1);

    settings.update({ "log.level": "debug" });
    await flushAll();

    expect(configureMock).toHaveBeenCalledTimes(2);
    const second = configureMock.mock.calls[1]![0]! as {
      loggers: Array<{ lowestLevel: string }>;
    };
    expect(second.loggers[0]!.lowestLevel).toBe("debug");
  });

  it("opens then closes the file sink as log.to-file toggles", async () => {
    await using harness = await makeLogging({
      "log.level": "info",
      "log.to-file": false,
    });
    const { settings, write } = harness;

    settings.update({ "log.to-file": true });
    await flushAll();
    expect(write).toHaveBeenCalledTimes(1);

    settings.update({ "log.to-file": false });
    await flushAll();

    const lastConfig = configureMock.mock.calls.at(-1)![0]! as {
      sinks: Record<string, unknown>;
    };
    expect(Object.keys(lastConfig.sinks)).toEqual(["console"]);
  });

  it("bail-if-same: rapid toggles coalesce — fewer configures than updates", async () => {
    await using harness = await makeLogging({
      "log.level": "info",
      "log.to-file": false,
    });
    const { settings } = harness;
    configureMock.mockClear();

    // Four rapid same-tick updates ending in `false`. The loop body for the
    // first update is already mid-flight when the others arrive, so they only
    // bump `#desired`. The loop trailer then applies the latest desired once.
    settings.update({ "log.to-file": true });
    settings.update({ "log.to-file": false });
    settings.update({ "log.to-file": true });
    settings.update({ "log.to-file": false });
    await flushAll();

    expect(configureMock.mock.calls.length).toBeLessThan(4);
    const last = configureMock.mock.calls.at(-1)![0]! as {
      sinks: Record<string, unknown>;
    };
    expect(Object.keys(last.sinks)).toEqual(["console"]);
  });

  it("background reconfigure failures are reported, not unhandled", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    await using harness = await makeLogging({
      "log.level": "info",
      "log.to-file": false,
    });
    const { settings } = harness;

    // First call (initial configure) already succeeded; reject the next one.
    configureMock.mockRejectedValueOnce(new Error("boom"));

    settings.update({ "log.level": "debug" });
    await flushAll();

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "LoggingService reconfigure failed",
      expect.any(Error),
    );

    consoleErrorSpy.mockRestore();
  });

  it("dispose waits for in-flight reconfigure so the sink doesn't leak", async () => {
    // Hold the configure() in iteration #2 so dispose races with it.
    let releaseSecond!: () => void;
    const secondCalled = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    configureMock.mockImplementationOnce(async () => undefined);
    configureMock.mockImplementationOnce(
      () =>
        new Promise<undefined>((resolve) => {
          void secondCalled.then(() => resolve(undefined));
        }),
    );

    const { logging, settings, append } = await makeLogging({
      "log.level": "info",
      "log.to-file": false,
    });

    settings.update({ "log.to-file": true });
    await flushAll(); // applyConfig opens the sink, then awaits configure (held)

    const disposing = logging[Symbol.asyncDispose]();
    await flushAll();

    // The second configure is still pending — releasing it lets the loop
    // finish, then dispose tears down the sink and resets LogTape.
    releaseSecond();
    await disposing;

    // After dispose, the sink interval is cleared — no late appends.
    await vi.advanceTimersByTimeAsync(5000);
    expect(append).not.toHaveBeenCalled();
  });

  it("dispose drains pending records and clears the file sink interval", async () => {
    const { logging, append } = await makeLogging({
      "log.level": "info",
      "log.to-file": true,
    });

    // Pull the real file sink from the configure() call so we can dispatch
    // records through it the way LogTape would.
    const config = configureMock.mock.calls[0]![0]! as unknown as {
      sinks: { file: Sink };
    };
    config.sinks.file(makeRecord("buffered"));
    expect(append).not.toHaveBeenCalled();

    await logging[Symbol.asyncDispose]();
    expect(append).toHaveBeenCalledTimes(1);
    expect(append.mock.calls[0]![1]).toContain('"buffered"');

    append.mockClear();
    await vi.advanceTimersByTimeAsync(5000);
    expect(append).not.toHaveBeenCalled();
  });
});
