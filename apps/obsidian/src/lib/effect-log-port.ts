import { setLibraryLogSink } from "@zotlit/shared/logging";
import type { LibraryLogRecord } from "@zotlit/shared/logging";

import {
  Cause,
  Effect,
  Layer,
  Logger,
  LogLevel,
  MutableRef,
  Option,
  Queue,
  Ref,
  References,
  Schema,
  Stream,
} from "@/lib/effect";
import { LogCategory, withLogCategory } from "@/lib/effect-log-category";

/** The lowest worker log level a [`ReadsConfig`] can select. */
export type PortLogLevel =
  | "trace"
  | "debug"
  | "info"
  | "warning"
  | "error"
  | "fatal";

/** A worker log record that survives the structured clone in a `MessagePort`. */
export const LogPortRecordSchema = Schema.Struct({
  level: Schema.Literals(["Fatal", "Error", "Warn", "Info", "Debug", "Trace"]),
  category: Schema.Array(Schema.String),
  message: Schema.String,
  details: Schema.Array(Schema.Unknown),
  annotations: Schema.Record(Schema.String, Schema.Unknown),
  error: Schema.NullOr(
    Schema.Struct({
      name: Schema.String,
      message: Schema.String,
      stack: Schema.NullOr(Schema.String),
    }),
  ),
  timestamp: Schema.Number,
});

export type LogPortRecord = typeof LogPortRecordSchema.Type;

/** The part of a `MessagePort` the logger bridge uses. */
export interface LogMessagePort {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage(message: unknown): void;
  close(): void;
}

const LEVELS: Readonly<Record<PortLogLevel, LogLevel.LogLevel>> = {
  trace: "Trace",
  debug: "Debug",
  info: "Info",
  warning: "Warn",
  error: "Error",
  fatal: "Fatal",
};

const rejectedText = (value: unknown): string => {
  switch (typeof value) {
    case "string":
      return value;
    case "number":
    case "bigint":
    case "boolean":
      return String(value);
    case "undefined":
      return "undefined";
    case "symbol":
      return Symbol.prototype.toString.call(value);
    case "function":
      return Function.prototype.toString.call(value);
    case "object":
      return value === null ? "null" : Object.prototype.toString.call(value);
  }
};

/**
 * Keep every annotation or detail value that can cross a `MessagePort`.
 *
 * Nested objects are checked as a whole first. If one member is rejected,
 * each member is checked separately so the rest of the value survives.
 */
const cloneSafe = (
  value: unknown,
  seen: WeakSet<object> = new WeakSet(),
): unknown => {
  // boundary: structuredClone is the API that decides MessagePort safety.
  try {
    structuredClone(value);
    return value;
  } catch {
    if (Array.isArray(value)) {
      if (seen.has(value)) return "[Circular]";
      seen.add(value);
      return value.map((item) => cloneSafe(item, seen));
    }
    if (value !== null && typeof value === "object") {
      if (value instanceof Map || value instanceof Set)
        return rejectedText(value);
      if (seen.has(value)) return "[Circular]";
      seen.add(value);
      const entries = Object.entries(value).map(([key, item]) => [
        key,
        cloneSafe(item, seen),
      ]);
      return Object.fromEntries(entries);
    }
    return rejectedText(value);
  }
};

const errorFromCause = (cause: Cause.Cause<unknown>) => {
  if (cause.reasons.length === 0) return null;
  const error = Cause.squash(cause);
  const fields: {
    readonly name?: unknown;
    readonly message?: unknown;
    readonly stack?: unknown;
  } = error !== null && typeof error === "object" ? error : {};
  return {
    name:
      typeof fields.name === "string" && fields.name.length > 0
        ? fields.name
        : "Error",
    message:
      typeof fields.message === "string" ? fields.message : rejectedText(error),
    stack: typeof fields.stack === "string" ? fields.stack : null,
  };
};

/** Convert an Effect log event to a record the worker port can post. */
export const makeLogPortRecord = (
  options: Logger.Options<unknown>,
): LogPortRecord => {
  const parts = Array.isArray(options.message)
    ? options.message
    : [options.message];
  return {
    level: options.logLevel as LogPortRecord["level"],
    category: [...options.fiber.getRef(LogCategory)],
    message: rejectedText(parts[0] ?? ""),
    details: parts.slice(1).map((part) => cloneSafe(part)),
    annotations: Object.fromEntries(
      Object.entries(
        options.fiber.getRef(References.CurrentLogAnnotations),
      ).map(([key, value]) => [key, cloneSafe(value)]),
    ),
    error: errorFromCause(options.cause),
    timestamp: options.date.getTime(),
  };
};

/**
 * An Effect logger that sends records through `port`.
 *
 * The level lives in `level`, so a later `Configure` changes the next record
 * without rebuilding an Effect runtime.
 */
export const makePortLogger = (
  port: Pick<LogMessagePort, "postMessage">,
  level: Ref.Ref<PortLogLevel | null>,
): Logger.Logger<unknown, void> => {
  const failedKinds = MutableRef.make<ReadonlySet<string>>(new Set());
  return Logger.make((options) => {
    const selected = Ref.getUnsafe(level);
    if (
      selected === null ||
      options.logLevel === "All" ||
      options.logLevel === "None" ||
      !LogLevel.isGreaterThanOrEqualTo(options.logLevel, LEVELS[selected])
    )
      return;

    const record = makeLogPortRecord(options);
    // boundary: the logger cannot report its own post failure through itself.
    try {
      port.postMessage(record);
    } catch (error) {
      const kind =
        error instanceof Error
          ? `${error.name}: ${error.message}`
          : rejectedText(error);
      if (failedKinds.current.has(kind)) return;
      failedKinds.current = new Set(failedKinds.current).add(kind);
      // oxlint-disable-next-line no-console -- the logger cannot report its own port failure.
      console.error("ZotLit worker log port failed:", kind, error);
    }
  });
};

/** Install the worker-side port logger as the Effect logger. */
export const layerPortLogger = (
  port: Pick<LogMessagePort, "postMessage">,
  level: Ref.Ref<PortLogLevel | null>,
): Layer.Layer<never> => Logger.layer([makePortLogger(port, level)]);

/** Re-emit records from app-agnostic libraries through the worker's logger. */
export const layerLibraryLogPort: Layer.Layer<never> = Layer.effectDiscard(
  Effect.gen(function* () {
    const records = yield* Queue.unbounded<LibraryLogRecord, Cause.Done>();
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        setLibraryLogSink((record) => Queue.offerUnsafe(records, record));
      }),
      () => Effect.sync(() => setLibraryLogSink(undefined)),
    );
    yield* Stream.fromQueue(records).pipe(
      Stream.runForEach((record) => {
        return emitLogPortRecord({
          level:
            record.level === "warn"
              ? "Warn"
              : record.level === "trace"
                ? "Trace"
                : record.level === "debug"
                  ? "Debug"
                  : record.level === "info"
                    ? "Info"
                    : record.level === "error"
                      ? "Error"
                      : "Fatal",
          category: record.category,
          message: record.message,
          details: [],
          annotations: record.properties,
          error: null,
          timestamp: Temporal.Now.instant().epochMilliseconds,
        });
      }),
      Effect.forkScoped,
    );
  }),
);

const emitLogPortRecord = (record: LogPortRecord) => {
  const annotations = {
    ...record.annotations,
    ...(record.error !== null && { error: record.error }),
  };
  return Effect.logWithLevel(record.level)(
    record.message,
    ...record.details,
  ).pipe(
    Effect.annotateLogs(annotations),
    withLogCategory(...(record.category as [string, ...string[]])),
  );
};

/**
 * Receive records from a worker's log port until the layer's Scope closes.
 *
 * The DOM callback is the only boundary. It queues the record, and a scoped
 * fiber re-emits it through the current renderer Effect logger.
 */
export const layerHostLogPort = (port: LogMessagePort): Layer.Layer<never> =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const records = yield* Queue.unbounded<LogPortRecord, Cause.Done>();
      // boundary: MessagePort delivers records through a DOM callback.
      const receive = ({ data }: MessageEvent) => {
        Queue.offerUnsafe(records, data);
      };
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          port.onmessage = receive;
        }),
        () =>
          Effect.sync(() => {
            port.onmessage = null;
            port.close();
          }).pipe(Effect.ensuring(Queue.end(records))),
      );
      yield* Stream.fromQueue(records).pipe(
        Stream.runForEach((data) => {
          const record = Schema.decodeUnknownOption(LogPortRecordSchema)(data);
          return Option.match(record, {
            onNone: () =>
              Effect.logWarning(
                "Ignored a malformed Zotero reads worker log record",
              ).pipe(withLogCategory("zotero-reads")),
            onSome: emitLogPortRecord,
          });
        }),
        Effect.forkScoped,
      );
    }),
  );
