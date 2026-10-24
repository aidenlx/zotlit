import * as Context from "effect/Context";
// oxlint-disable-next-line no-restricted-imports -- This category reference must not load the renderer logging bridge.
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
