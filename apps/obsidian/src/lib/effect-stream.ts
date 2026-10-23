// A Stream handed to code that lives outside Effect, as a callback subscription.
import type { ManagedRuntime } from "@/lib/effect";
import { Cause, Effect, Stream } from "@/lib/effect";
import { withLogCategory } from "@/lib/effect-log";

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
