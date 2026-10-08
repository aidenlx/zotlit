// The `Changes` feed both adapters publish: lifecycle events, replayed from the current state to each subscriber.
import { Effect, PubSub, Stream } from "effect";

import type { EffectiveReadMode } from "@/services/database/read-source";

import type { ChangeEvent, DbUnavailable } from "./rpc";

/**
 * The `Changes` feed: lifecycle events, each subscriber first getting the
 * events that `seed` builds, starting with the `state` event.
 */
export const makeChangeFeed = Effect.fnUntraced(function* (
  seed: () => readonly [ChangeEvent, ...ChangeEvent[]],
) {
  const events = yield* PubSub.unbounded<ChangeEvent>();
  return {
    publish: (event: ChangeEvent) =>
      PubSub.publish(events, event).pipe(Effect.asVoid),
    // Subscribe before reading the state, so no event falls between the
    // seed and the live feed.
    changes: Stream.unwrap(
      Effect.map(PubSub.subscribe(events), (subscription) =>
        Stream.concat(
          Stream.fromIterable(seed()),
          Stream.fromSubscription(subscription),
        ),
      ),
    ),
  };
});

/** The lifecycle facts a new `Changes` subscriber starts from. */
export interface FeedState {
  readonly state: "loading" | "ready" | "degraded";
  readonly error: DbUnavailable | null;
  /** The serving connection's Read Mode; sent only while ready. */
  readonly readMode?: EffectiveReadMode | null | undefined;
  /**
   * The missing-file signal was raised. A subscriber that arrives after it
   * (the renderer subscribes once the worker is up) still gets it while no
   * connection serves.
   */
  readonly missing: boolean;
}

/** A {@link makeChangeFeed} seeded from `current()`. */
export const makeStateFeed = (current: () => FeedState) =>
  makeChangeFeed(() => {
    const { state, error, readMode, missing } = current();
    const seed: ChangeEvent = {
      _tag: "state",
      state,
      error,
      ...(state === "ready" && readMode && { readMode }),
    };
    return missing && state !== "ready"
      ? [seed, { _tag: "db-file-missing" }]
      : [seed];
  });
