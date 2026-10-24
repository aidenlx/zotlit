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
  /** The original message before placeholder substitution. */
  readonly rawMessage: string;
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
    rawMessage: message,
    properties: properties ?? {},
  });
};
