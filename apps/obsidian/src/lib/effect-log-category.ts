import * as Context from "effect/Context";

export { LogCategory, withLogCategory } from "@zotlit/shared/logging";

/**
 * When the record being logged happened, in epoch milliseconds, if that is
 * earlier than the log call: the host sets it on a record a worker posted so
 * the sink shows the worker's time, not the time the host received it.
 */
export const LogTimestamp = Context.Reference<number | undefined>(
  "zotlit/effect-log/LogTimestamp",
  { defaultValue: () => undefined },
);
