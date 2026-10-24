import { describe, expect, vi } from "vitest";

import { logLibrary } from "@zotlit/shared/logging";

import { Cause, Effect, Layer, Logger, Ref, References } from "@/lib/effect";
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
}

const captureLogger = (captured: CapturedLog[]) =>
  Logger.make(({ logLevel, message, fiber }) => {
    captured.push({
      level: logLevel,
      message,
      category: fiber.getRef(LogCategory),
      annotations: fiber.getRef(References.CurrentLogAnnotations),
    });
  });

const yieldToConsumer = Effect.gen(function* () {
  for (let turn = 0; turn < 20; turn++) yield* Effect.yieldNow;
});

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
      const captured: CapturedLog[] = [];
      const ports = channel();
      const level = yield* Ref.make<PortLogLevel | null>("trace");
      const workerLayer = layerPortLogger(ports.worker, level);

      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* Layer.build(layerHostLogPort(ports.host));
          yield* logThrough(
            workerLayer,
            "zotero-reads",
            Effect.logInfo("Opened database", { mode: "copy" }).pipe(
              Effect.annotateLogs({ itemID: 7, library: "ABCD" }),
            ),
          );
          yield* yieldToConsumer;
        }),
      ).pipe(Effect.provide(Logger.layer([captureLogger(captured)])));

      expect(captured).toEqual([
        {
          level: "Info",
          message: ["Opened database", { mode: "copy" }],
          category: ["zotero-reads"],
          annotations: { itemID: 7, library: "ABCD" },
        },
      ]);
    }),
  );

  it.effect("honours the level on each record and a later level change", () =>
    Effect.gen(function* () {
      const captured: CapturedLog[] = [];
      const ports = channel();
      const level = yield* Ref.make<PortLogLevel | null>("info");
      const workerLayer = layerPortLogger(ports.worker, level);

      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* Layer.build(layerHostLogPort(ports.host));
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
          yield* yieldToConsumer;
        }),
      ).pipe(Effect.provide(Logger.layer([captureLogger(captured)])));

      expect(captured.map(({ message }) => message)).toEqual([
        ["shown"],
        ["shown after configure"],
      ]);
    }),
  );

  it.effect("re-emits library logs through the worker Effect logger", () =>
    Effect.gen(function* () {
      const captured: CapturedLog[] = [];
      const ports = channel();
      const level = yield* Ref.make<PortLogLevel | null>("trace");

      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* Layer.build(layerHostLogPort(ports.host));
          yield* Effect.sync(() =>
            logLibrary({
              level: "debug",
              category: ["zotlit", "item-query"],
              message: "Candidate plan selected",
              properties: { plan: "candidates" },
            }),
          );
          yield* yieldToConsumer;
        }).pipe(
          Effect.provide(layerPortLogger(ports.worker, level)),
          Effect.provide(layerLibraryLogPort),
        ),
      ).pipe(Effect.provide(Logger.layer([captureLogger(captured)])));

      expect(captured).toEqual([
        {
          level: "Debug",
          message: ["Candidate plan selected"],
          category: ["zotlit", "item-query"],
          annotations: { plan: "candidates" },
        },
      ]);
    }),
  );

  it.effect(
    "replaces an uncloneable annotation instead of failing to post",
    () =>
      Effect.gen(function* () {
        const captured: CapturedLog[] = [];
        const ports = channel();
        const level = yield* Ref.make<PortLogLevel | null>("trace");
        const workerLayer = layerPortLogger(ports.worker, level);

        yield* Effect.scoped(
          Effect.gen(function* () {
            yield* Layer.build(layerHostLogPort(ports.host));
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
            yield* yieldToConsumer;
          }),
        ).pipe(Effect.provide(Logger.layer([captureLogger(captured)])));

        expect(captured[0]?.annotations).toEqual({
          safe: "value",
          rejected: "Symbol(annotation)",
        });
      }),
  );

  it.effect("reports a failed post once for each failure kind", () =>
    Effect.gen(function* () {
      const error = new TypeError("port closed");
      const postMessage = vi.fn(() => {
        throw error;
      });
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      const level = yield* Ref.make<PortLogLevel | null>("trace");
      const workerLogger = makePortLogger({ postMessage }, level);
      const options = {
        message: ["failed"],
        logLevel: "Error" as const,
        cause: Cause.empty,
        fiber: {
          getRef: (reference: unknown) =>
            reference === LogCategory
              ? ["zotero-reads"]
              : reference === References.CurrentLogAnnotations
                ? {}
                : [],
        },
        // oxlint-disable-next-line no-restricted-globals -- Effect supplies Date in Logger.Options.
        date: new Date(0),
      };

      workerLogger.log(options as never);
      workerLogger.log(options as never);

      expect(postMessage).toHaveBeenCalledTimes(2);
      expect(consoleError).toHaveBeenCalledOnce();
      consoleError.mockRestore();
    }),
  );

  it.effect("emits the squashed cause under the error annotation", () =>
    Effect.gen(function* () {
      const captured: CapturedLog[] = [];
      const ports = channel();
      const level = yield* Ref.make<PortLogLevel | null>("trace");
      const workerLogger = makePortLogger(ports.worker, level);

      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* Layer.build(layerHostLogPort(ports.host));
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
          yield* yieldToConsumer;
        }),
      ).pipe(Effect.provide(Logger.layer([captureLogger(captured)])));

      expect(captured[0]).toMatchObject({
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
  );

  it.effect("closes the host port and ends its consumer with the Scope", () =>
    Effect.gen(function* () {
      const captured: CapturedLog[] = [];
      const ports = channel();

      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* Layer.build(layerHostLogPort(ports.host));
          expect(ports.host.onmessage).not.toBeNull();
        }),
      ).pipe(Effect.provide(Logger.layer([captureLogger(captured)])));

      expect(ports.host.onmessage).toBeNull();
      expect(ports.host.closed).toBe(true);
      expect(captured).toEqual([]);
    }),
  );
});
