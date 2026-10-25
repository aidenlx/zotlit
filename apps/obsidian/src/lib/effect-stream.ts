// State Streams and callback subscriptions shared by Effect services and adapters.
import type { ManagedRuntime, Scope } from "@/lib/effect";
import { Effect, Stream } from "@/lib/effect";
import { logAndContinue } from "@/lib/effect-log";
import { isScopeClosed } from "@/lib/effect-scope";

/** The events of one tag from a tagged-union Stream, narrowed to that member. */
export function filterTag<
  A extends { readonly _tag: string },
  T extends A["_tag"],
>(stream: Stream.Stream<A>, tag: T): Stream.Stream<Extract<A, { _tag: T }>> {
  return stream.pipe(
    Stream.filter(
      (event): event is Extract<A, { _tag: T }> => event._tag === tag,
    ),
  );
}

/** The plugin runtime surface used by plain Stream consumers. */
export type SubscriptionRuntime = Pick<
  ManagedRuntime.ManagedRuntime<never, never>,
  "runFork" | "scope"
>;

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
      logAndContinue("Stream consumer failed", "effect-stream"),
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
      }).pipe(logAndContinue("Stream subscriber failed", "effect-stream")),
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
