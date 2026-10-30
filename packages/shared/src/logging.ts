// The library log sink and the shared Effect log category for library packages.
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

/** The category a worker record carries through the plugin's log bridge. */
export const LogCategory = Context.Reference<readonly string[]>(
  "zotlit/effect-log/LogCategory",
  { defaultValue: () => [] },
);

/** File the logs of an Effect under `category`. */
export const withLogCategory =
  (...category: [string, ...string[]]) =>
  <A, E, R>(self: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.provideService(self, LogCategory, category);

/** A log level understood by the plugin's LogTape and Effect bridges. */
export type LibraryLogLevel =
  | "trace"
  | "debug"
  | "info"
  | "warn"
  | "error"
  | "fatal";

/** One record from an app-agnostic library. */
export interface LibraryLogRecord {
  readonly level: LibraryLogLevel;
  /** The full category, including its `zotlit` root. */
  readonly category: readonly [string, ...string[]];
  readonly message: string;
  readonly properties: Readonly<Record<string, unknown>>;
}

export type LibraryLogSink = (record: LibraryLogRecord) => void;

/** A record before the sink fills in its defaults. */
export interface LibraryLogInput {
  readonly level: LibraryLogLevel;
  readonly category: readonly [string, ...string[]];
  readonly message: string;
  readonly properties?: Readonly<Record<string, unknown>>;
}

let sink: LibraryLogSink | undefined;

/** Install the host that receives library records in this JavaScript realm. */
export const setLibraryLogSink = (next: LibraryLogSink | undefined): void => {
  sink = next;
};

/** Send one record to the host, or drop it while no host is installed. */
export const logLibrary = ({
  level,
  category,
  message,
  properties,
}: LibraryLogInput): void => {
  sink?.({
    level,
    category,
    message,
    properties: properties ?? {},
  });
};
