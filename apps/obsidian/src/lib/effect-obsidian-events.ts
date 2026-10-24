import type { Events } from "obsidian";

import { Cause, Effect, PubSub, Stream } from "@/lib/effect";
import { withLogCategory } from "@/lib/effect-log";

type Payload<E> = {
  [K in keyof E]: { readonly type: K; readonly args: E[K] };
}[keyof E];

/**
 * One ordered intake for a layer's Obsidian events. The subscription exists
 * before registration, including one-shots that call back immediately.
 * Fork `consume(handler)` on the layer's Scope. Each failed event is logged
 * with its cause; consumption continues until interruption. `on` owns an Events
 * registration; `callback` also adapts onLayoutReady and onCleanCache. Late
 * one-shot callbacks are harmless after the Scope shuts down the PubSub.
 */
export const obsidianEvents = Effect.fnUntraced(function* <
  E extends { [K in keyof E]: unknown[] },
>() {
  const bus = yield* PubSub.unbounded<Payload<E>>();
  yield* Effect.addFinalizer(() => PubSub.shutdown(bus));
  const subscription = yield* PubSub.subscribe(bus);

  let pending = 0;
  const callback =
    <K extends keyof E>(type: K) =>
    (...args: E[K]): void => {
      pending += 1;
      if (!PubSub.publishUnsafe(bus, { type, args } as Payload<E>))
        pending -= 1;
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

  const stream = Stream.fromSubscription(subscription);
  const consume = Effect.fnUntraced(function* <A, Error, R>(
    handler: (event: Payload<E>) => Effect.Effect<A, Error, R>,
  ) {
    const dispatch = Effect.fnUntraced(
      function* (event: Payload<E>) {
        pending -= 1;
        yield* handler(event);
      },
      (effect, event) =>
        effect.pipe(
          Effect.catchCause((cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.interrupt
              : Effect.logError("Obsidian event handler failed", cause).pipe(
                  Effect.annotateLogs({ event: event.type }),
                  withLogCategory("obsidian-events"),
                ),
          ),
        ),
    );
    yield* Stream.runForEach(stream, dispatch);
  });

  return {
    stream,
    consume,
    on,
    callback,
    /** Payloads published but not yet dispatched by consume, including buffered chunks. */
    get pending() {
      return pending;
    },
  };
});
