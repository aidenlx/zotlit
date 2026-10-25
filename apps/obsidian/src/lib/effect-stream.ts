// State Streams and callback subscriptions shared by Effect services and adapters.
import type { ManagedRuntime, Scope, SubscriptionRef } from "@/lib/effect";
import { Cause, Effect, PubSub, Stream } from "@/lib/effect";
import { withLogCategory } from "@/lib/effect-log";
import { isScopeClosed } from "@/lib/effect-scope";

/**
 * The events of the given tags from a tagged-union Stream, narrowed to those
 * members. One pass over the Stream, so the order across tags stays.
 */
export function filterTag<
  A extends { readonly _tag: string },
  T extends A["_tag"],
>(
  stream: Stream.Stream<A>,
  ...tags: [T, ...T[]]
): Stream.Stream<Extract<A, { _tag: T }>> {
  const wanted = new Set<string>(tags);
  return stream.pipe(
    Stream.filter((event): event is Extract<A, { _tag: T }> =>
      wanted.has(event._tag),
    ),
  );
}

/** The plugin runtime surface used by plain Stream consumers. */
export type SubscriptionRuntime = Pick<
  ManagedRuntime.ManagedRuntime<never, never>,
  "runFork" | "scope"
>;

/**
 * Replay state and retain every update until the service stops: the one way a
 * service exposes a `SubscriptionRef`. The subscription is acquired when the
 * Stream starts and each update reaches it on the publisher's fiber, so a
 * consumer started immediately during layer acquisition attaches before the
 * layer returns and sees every update in the same tick it is made. Each
 * consumer owns its subscription through the Stream's Scope.
 *
 * @param until The service's stop signal, or a terminal-state predicate. The
 *   signal shuts the state's PubSub down, which ends every subscriber. A
 *   predicate's matching value is the last one emitted, so a subscriber after
 *   close still receives that snapshot.
 */
export function changesUntil<A>(
  state: SubscriptionRef.SubscriptionRef<A>,
  until: Effect.Effect<void> | ((value: A) => boolean),
): Stream.Stream<A> {
  return Stream.unwrap(
    Effect.gen(function* () {
      const changes = Stream.fromSubscription(
        yield* PubSub.subscribe(state.pubsub),
      );
      if (typeof until === "function")
        return changes.pipe(Stream.takeUntil(until));
      yield* Effect.forkScoped(
        Effect.andThen(until, PubSub.shutdown(state.pubsub)),
        { startImmediately: true },
      );
      return changes;
    }),
  );
}

/**
 * Run `handle` for each element of `stream` on the current Scope: the Effect
 * side of {@link subscribe}, for a layer consuming another service's Stream.
 * Started immediately, so the consumer attaches before acquisition returns. A
 * failing element is logged with its cause and later elements still arrive.
 */
export function forkEach<A, R, R2 = never>(
  stream: Stream.Stream<A, never, R>,
  handle: (value: A) => Effect.Effect<unknown, unknown, R2> | void,
) {
  return Stream.runForEach(stream, (value) =>
    Effect.suspend(() => handle(value) ?? Effect.void).pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.interrupt
          : Effect.logError("Stream consumer failed", cause).pipe(
              withLogCategory("effect-stream"),
            ),
      ),
    ),
  ).pipe(Effect.forkScoped({ startImmediately: true }));
}

/**
 * Call `callback` with each element of `stream`, run by `runtime`, until the
 * returned function stops the subscription. No element reaches `callback`
 * after that function returns. Attaches before returning; each throwing
 * callback is logged and later elements still arrive. A disposed runtime
 * returns a no-op unsubscribe.
 */
export function subscribe<A, R>(
  runtime: Pick<ManagedRuntime.ManagedRuntime<R, never>, "runFork"> & {
    readonly scope: Scope.Scope;
  },
  stream: Stream.Stream<A, never, R>,
  callback: (value: A) => void,
): () => void {
  if (isScopeClosed(runtime.scope)) return () => {};
  let active = true;
  const fiber = runtime.runFork(
    Stream.runForEach(stream, (value) =>
      Effect.sync(() => {
        if (active) callback(value);
      }).pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.interrupt
            : Effect.logError("Stream subscriber failed", cause).pipe(
                withLogCategory("effect-stream"),
              ),
        ),
      ),
    ),
  );
  // Operators such as interruptWhen fork upstream consumption. Drain that
  // startup before a caller publishes changes that latest-value replay loses.
  fiber.currentDispatcher.flush();
  return () => {
    active = false;
    fiber.interruptUnsafe();
  };
}
