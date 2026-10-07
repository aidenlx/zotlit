// The `Changes` feed both adapters publish: lifecycle events, replayed from the current state to each subscriber.
import { Effect, PubSub, Stream } from "effect";

import type { ChangeEvent } from "./rpc";

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
