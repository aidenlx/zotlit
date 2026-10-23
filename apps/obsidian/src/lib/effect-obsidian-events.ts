import type { Events } from "obsidian";

import { Effect, PubSub, Stream } from "@/lib/effect";

type Payload<E> = {
  [K in keyof E]: { readonly type: K; readonly args: E[K] };
}[keyof E];

/**
 * One ordered intake for a layer's Obsidian events. The subscription exists
 * before registration, including one-shots that call back immediately.
 * Fork one consumer of `stream` on the layer's Scope. `on` owns an Events
 * registration; `callback` also adapts onLayoutReady and onCleanCache. Late
 * one-shot callbacks are harmless after the Scope shuts down the PubSub.
 */
export const obsidianEvents = Effect.fnUntraced(function* <
  E extends { [K in keyof E]: unknown[] },
>() {
  const bus = yield* PubSub.unbounded<Payload<E>>();
  yield* Effect.addFinalizer(() => PubSub.shutdown(bus));
  const subscription = yield* PubSub.subscribe(bus);

  const callback =
    <K extends keyof E>(type: K) =>
    (...args: E[K]): void => {
      PubSub.publishUnsafe(bus, { type, args } as Payload<E>);
    };

  const on = Effect.fnUntraced(function* (
    type: keyof E,
    source: Pick<Events, "on" | "offref">,
    name: string,
  ) {
    return yield* Effect.acquireRelease(
      // Obsidian's base Events API erases event-specific argument types.
      Effect.sync(() =>
        source.on(name, callback(type) as (...args: unknown[]) => void),
      ),
      (ref) => Effect.sync(() => source.offref(ref)),
    );
  });

  return { stream: Stream.fromSubscription(subscription), on, callback };
});
