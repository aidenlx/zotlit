import { it } from "@effect/vitest";
import { configureSync, resetSync } from "@logtape/logtape";
import type { LogRecord } from "@logtape/logtape";
import { DateTime, Effect, Layer, Logger, Queue } from "effect";
import { describe, expect } from "vitest";

import { logLibrary } from "@zotlit/shared/logging";

import { logTapeLogger, withLogCategory } from "./effect-log";
import { layerHostLogPort } from "./effect-log-port";
import type { LogMessagePort, LogPortRecord } from "./effect-log-port";

/** A time no wall clock reads, so only the worker's stamp can produce it. */
const WORKER_LOG_TIME = DateTime.toEpochMillis(
  DateTime.makeUnsafe("2001-02-03T04:05:06Z"),
);

const captureLogTape = Effect.acquireRelease(
  Effect.gen(function* () {
    const captured = yield* Queue.unbounded<LogRecord>();
    configureSync({
      reset: true,
      sinks: { capture: (record) => Queue.offerUnsafe(captured, record) },
      loggers: [
        { category: ["zotlit"], sinks: ["capture"], lowestLevel: "trace" },
      ],
    });
    return captured;
  }),
  () => Effect.sync(() => resetSync()),
);

const hostPort = (): LogMessagePort => ({
  onmessage: null,
  postMessage: () => undefined,
  close: () => undefined,
});

const workerRecord = (
  overrides: Partial<LogPortRecord> = {},
): LogPortRecord => ({
  level: "Warn",
  category: ["zotlit", "db", "tags"],
  message: "Unknown tag type {type}",
  details: [],
  annotations: { type: 99 },
  error: null,
  timestamp: WORKER_LOG_TIME,
  ...overrides,
});

describe("logTapeLogger", () => {
  it.effect("keeps the worker's timestamp on a record the host re-emits", () =>
    Effect.gen(function* () {
      const captured = yield* captureLogTape;
      const port = hostPort();
      yield* Layer.build(
        layerHostLogPort(port, {
          malformedMessage: "malformed",
          category: ["zotero-reads"],
        }),
      );

      port.onmessage?.({ data: workerRecord() } as MessageEvent);
      const record = yield* Queue.take(captured);

      expect(record.timestamp).toBe(WORKER_LOG_TIME);
      expect(record.level).toBe("warning");
      expect(record.category).toEqual(["zotlit", "db", "tags"]);
      expect(record.message).toEqual(["Unknown tag type ", 99, ""]);
      expect(record.properties).toEqual({ type: 99 });
    }).pipe(Effect.scoped, Effect.provide(Logger.layer([logTapeLogger]))),
  );

  it.effect(
    "leaves a record without a LogTimestamp to LogTape's template parsing and clock",
    () =>
      Effect.gen(function* () {
        const captured = yield* captureLogTape;

        yield* Effect.logInfo("Opened {library.name}").pipe(
          Effect.annotateLogs({ library: { name: "ABCD" } }),
          withLogCategory("zotlit", "db"),
        );
        const record = yield* Queue.take(captured);

        expect(record.message).toEqual(["Opened ", "ABCD", ""]);
        expect(record.timestamp).toBeGreaterThan(WORKER_LOG_TIME);
      }).pipe(Effect.scoped, Effect.provide(Logger.layer([logTapeLogger]))),
  );
});

describe("library log sink in the renderer", () => {
  it.effect("reaches LogTape through the sink the bridge installs", () =>
    Effect.gen(function* () {
      const captured = yield* captureLogTape;

      logLibrary({
        level: "warn",
        category: ["zotlit", "db", "tags"],
        message: "Unknown tag type {type}",
        properties: { type: 99 },
      });
      const record = yield* Queue.take(captured);

      expect(record.level).toBe("warning");
      expect(record.category).toEqual(["zotlit", "db", "tags"]);
      expect(record.message).toEqual(["Unknown tag type ", 99, ""]);
    }).pipe(Effect.scoped),
  );
});
