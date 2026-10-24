// State Streams and callback subscriptions shared by Effect services and adapters.
import type { ManagedRuntime, SubscriptionRef } from "@/lib/effect";
import { Cause, Effect, PubSub, Stream } from "@/lib/effect";
import { withLogCategory } from "@/lib/effect-log";

/** The plugin runtime surface used by plain Stream consumers. */
export type SubscriptionRuntime = Pick<
  ManagedRuntime.ManagedRuntime<never, never>,
  "runFork" | "scope"
>;

/**
 * Replay state and retain every update until the service stops. Acquire the
 * subscription before interruptWhen forks upstream, so a consumer started
 * immediately during layer acquisition attaches before the layer returns.
 * Each consumer owns its subscription through the Stream's Scope.
 */
export function changesUntil<A>(
  state: SubscriptionRef.SubscriptionRef<A>,
  stopped: Effect.Effect<void>,
): Stream.Stream<A> {
  return Stream.unwrap(
    Effect.map(PubSub.subscribe(state.pubsub), (subscription) =>
      Stream.fromSubscription(subscription).pipe(Stream.interruptWhen(stopped)),
    ),
  );
}

/**
 * Call `callback` with each element of `stream`, run by `runtime`, until the
 * returned function stops the subscription. No element reaches `callback`
 * after that function returns. Attaches before returning; each throwing
 * callback is logged and later elements still arrive. A disposed runtime
 * returns a no-op unsubscribe.
 */
export function subscribe<A, R>(
  runtime: Pick<ManagedRuntime.ManagedRuntime<R, never>, "runFork" | "scope">,
  stream: Stream.Stream<A, never, R>,
  callback: (value: A) => void,
): () => void {
  if (runtime.scope.state._tag === "Closed") return () => {};
  let active = true;
  const fiber = runtime.runFork(
    Stream.runForEach(stream, (value) =>
      Effect.sync(() => {
        if (active) callback(value);
      }).pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterrupts(cause)
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
