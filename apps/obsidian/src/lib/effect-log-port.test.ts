import { TestClock } from "effect/testing";
import { describe, expect, vi } from "vitest";

import { logLibrary } from "@zotlit/shared/logging";

import {
  Cause,
  Effect,
  Layer,
  Logger,
  Queue,
  Ref,
  References,
} from "@/lib/effect";
import { it } from "@/lib/effect-vitest";

import { LogCategory, withLogCategory } from "./effect-log";
import {
  layerHostLogPort,
  layerLibraryLogPort,
  layerPortLogger,
  makePortLogger,
} from "./effect-log-port";
import type { LogMessagePort, PortLogLevel } from "./effect-log-port";

interface CapturedLog {
  readonly level: string;
  readonly message: unknown;
  readonly category: readonly string[];
  readonly annotations: Readonly<Record<string, unknown>>;
  readonly timestamp: number;
}

const captureLogger = (captured: Queue.Queue<CapturedLog>) =>
  Logger.make(({ logLevel, message, fiber, date }) => {
    Queue.offerUnsafe(captured, {
      level: logLevel,
      message,
      category: fiber.getRef(LogCategory),
      annotations: fiber.getRef(References.CurrentLogAnnotations),
      timestamp: date.getTime(),
    });
  });

const HOST_LOG_PORT = {
  malformedMessage: "Ignored a malformed Zotero reads worker log record",
  category: ["zotero-reads"],
} as const;

class FakePort implements LogMessagePort {
  peer: FakePort | undefined;
  onmessage: ((event: MessageEvent) => void) | null = null;
  readonly posted: unknown[] = [];
  closed = false;

  postMessage(message: unknown): void {
    const cloned = structuredClone(message);
    this.posted.push(cloned);
    this.peer?.onmessage?.(
      new MessageEvent("message", { data: structuredClone(cloned) }),
    );
  }

  close(): void {
    this.closed = true;
  }
}

const channel = () => {
  const host = new FakePort();
  const worker = new FakePort();
  host.peer = worker;
  worker.peer = host;
  return { host, worker };
};

const logThrough = (
  workerLayer: Layer.Layer<never>,
  category: string,
  effect: Effect.Effect<void>,
) => effect.pipe(Effect.provide(workerLayer), withLogCategory(category));

describe("Effect log port", () => {
  it.effect("round-trips the level, category, annotations, and details", () =>
    Effect.gen(function* () {
      const captured = yield* Queue.unbounded<CapturedLog>();
      const ports = channel();
      const level = yield* Ref.make<PortLogLevel | null>("trace");
      const workerLayer = layerPortLogger(ports.worker, level);

      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* Layer.build(layerHostLogPort(ports.host, HOST_LOG_PORT));
          yield* logThrough(
            workerLayer,
            "zotero-reads",
            Effect.logInfo("Opened database", { mode: "copy" }).pipe(
              Effect.annotateLogs({ itemID: 7, library: "ABCD" }),
            ),
          );
          expect(yield* Queue.take(captured)).toEqual({
            level: "Info",
            message: ["Opened database", { mode: "copy" }],
            category: ["zotero-reads"],
            annotations: { itemID: 7, library: "ABCD" },
            timestamp: expect.any(Number),
          });
        }),
      ).pipe(Effect.provide(Logger.layer([captureLogger(captured)])));
    }),
  );

  it.effect("honours the level on each record and a later level change", () =>
    Effect.gen(function* () {
      const captured = yield* Queue.unbounded<CapturedLog>();
      const ports = channel();
      const level = yield* Ref.make<PortLogLevel | null>("info");
      const workerLayer = layerPortLogger(ports.worker, level);

      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* Layer.build(layerHostLogPort(ports.host, HOST_LOG_PORT));
          yield* logThrough(
            workerLayer,
            "zotero-reads",
            Effect.logDebug("hidden"),
          );
          yield* logThrough(
            workerLayer,
            "zotero-reads",
            Effect.logInfo("shown"),
          );
          yield* Ref.set(level, "debug");
          yield* logThrough(
            workerLayer,
            "zotero-reads",
            Effect.logDebug("shown after configure"),
          );
          yield* Ref.set(level, null);
          yield* logThrough(
            workerLayer,
            "zotero-reads",
            Effect.logError("disabled"),
          );
          const first = yield* Queue.take(captured);
          const second = yield* Queue.take(captured);
          expect([first.message, second.message]).toEqual([
            ["shown"],
            ["shown after configure"],
          ]);
        }),
      ).pipe(Effect.provide(Logger.layer([captureLogger(captured)])));
    }),
  );

  it.effect("re-emits library logs through the worker Effect logger", () =>
    Effect.gen(function* () {
      const captured = yield* Queue.unbounded<CapturedLog>();
      const ports = channel();
      const level = yield* Ref.make<PortLogLevel | null>("trace");

      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* Layer.build(layerHostLogPort(ports.host, HOST_LOG_PORT));
          yield* TestClock.adjust("123 millis");
          yield* Effect.sync(() =>
            logLibrary({
              level: "debug",
              category: ["zotlit", "item-query"],
              message: "Candidate plan selected",
              properties: { plan: "candidates" },
            }),
          );
          const emitted = yield* Queue.take(captured);
          expect(emitted).toEqual({
            level: "Debug",
            message: ["Candidate plan selected"],
            category: ["zotlit", "item-query"],
            annotations: { plan: "candidates" },
            timestamp: 123,
          });
        }).pipe(
          Effect.provide(layerPortLogger(ports.worker, level)),
          Effect.provide(layerLibraryLogPort),
        ),
      ).pipe(Effect.provide(Logger.layer([captureLogger(captured)])));
    }),
  );

  it.effect(
    "replaces an uncloneable annotation instead of failing to post",
    () =>
      Effect.gen(function* () {
        const captured = yield* Queue.unbounded<CapturedLog>();
        const ports = channel();
        const level = yield* Ref.make<PortLogLevel | null>("trace");
        const workerLayer = layerPortLogger(ports.worker, level);

        yield* Effect.scoped(
          Effect.gen(function* () {
            yield* Layer.build(layerHostLogPort(ports.host, HOST_LOG_PORT));
            yield* logThrough(
              workerLayer,
              "zotero-reads",
              Effect.logInfo("annotation").pipe(
                Effect.annotateLogs({
                  safe: "value",
                  rejected: Symbol("annotation"),
                }),
              ),
            );
            expect((yield* Queue.take(captured)).annotations).toEqual({
              safe: "value",
              rejected: "Symbol(annotation)",
            });
          }),
        ).pipe(Effect.provide(Logger.layer([captureLogger(captured)])));
      }),
  );

  it.effect("reports a failed post once for each failure kind", () =>
    Effect.gen(function* () {
      const errors = [
        new TypeError("port closed"),
        new RangeError("port detached"),
      ] as const;
      let attempt = 0;
      const postMessage = vi.fn(() => {
        throw errors[attempt++];
      });
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      const level = yield* Ref.make<PortLogLevel | null>("trace");
      const workerLogger = makePortLogger({ postMessage }, level);

      yield* Effect.gen(function* () {
        yield* Effect.logError("first failed post");
        yield* Effect.logError("second failed post");
      }).pipe(Effect.provide(Logger.layer([workerLogger])));

      expect(postMessage).toHaveBeenCalledTimes(2);
      expect(consoleError).toHaveBeenCalledTimes(2);
      expect(consoleError.mock.calls.map(([, kind]) => kind)).toEqual([
        "TypeError: port closed",
        "RangeError: port detached",
      ]);
      consoleError.mockRestore();
    }),
  );

  it.effect("emits the squashed cause under the error annotation", () =>
    Effect.gen(function* () {
      const captured = yield* Queue.unbounded<CapturedLog>();
      const ports = channel();
      const level = yield* Ref.make<PortLogLevel | null>("trace");
      const workerLogger = makePortLogger(ports.worker, level);

      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* Layer.build(layerHostLogPort(ports.host, HOST_LOG_PORT));
          workerLogger.log({
            message: ["Citation lookup failed"],
            logLevel: "Error",
            cause: Cause.fail(new TypeError("bad lookup")),
            fiber: {
              getRef: (reference: unknown) =>
                reference === LogCategory
                  ? ["citation-index"]
                  : reference === References.CurrentLogAnnotations
                    ? { itemID: 9 }
                    : [],
            },
            // oxlint-disable-next-line no-restricted-globals -- Effect supplies Date in Logger.Options.
            date: new Date(0),
          } as never);
          expect(yield* Queue.take(captured)).toMatchObject({
            level: "Error",
            message: ["Citation lookup failed"],
            category: ["citation-index"],
            annotations: {
              itemID: 9,
              error: {
                name: "TypeError",
                message: "bad lookup",
              },
            },
          });
        }),
      ).pipe(Effect.provide(Logger.layer([captureLogger(captured)])));
    }),
  );

  it.effect("closes the host port and ends its consumer with the Scope", () =>
    Effect.gen(function* () {
      const captured = yield* Queue.unbounded<CapturedLog>();
      const ports = channel();
      const level = yield* Ref.make<PortLogLevel | null>("trace");

      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* Layer.build(layerHostLogPort(ports.host, HOST_LOG_PORT));
          expect(ports.host.onmessage).not.toBeNull();
          yield* Effect.logInfo("before close").pipe(
            Effect.provide(layerPortLogger(ports.worker, level)),
          );
          expect(yield* Queue.take(captured)).toMatchObject({
            message: ["before close"],
          });
        }),
      ).pipe(Effect.provide(Logger.layer([captureLogger(captured)])));

      expect(ports.host.onmessage).toBeNull();
      expect(ports.host.closed).toBe(true);
      expect(Queue.sizeUnsafe(captured)).toBe(0);
    }),
  );
});
