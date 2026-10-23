// A Stream handed to code that lives outside Effect, as a callback subscription.
import type { ManagedRuntime } from "@/lib/effect";
import { Effect, Stream } from "@/lib/effect";

/**
 * Call `callback` with each element of `stream`, run by `runtime`, until the
 * returned function stops the subscription. No element reaches `callback`
 * after that function returns.
 */
export function subscribe<A, R>(
  runtime: ManagedRuntime.ManagedRuntime<R, never>,
  stream: Stream.Stream<A, never, R>,
  callback: (value: A) => void,
): () => void {
  let active = true;
  const fiber = runtime.runFork(
    Stream.runForEach(stream, (value) =>
      Effect.sync(() => {
        if (active) callback(value);
      }),
    ),
  );
  return () => {
    active = false;
    fiber.interruptUnsafe();
  };
}
