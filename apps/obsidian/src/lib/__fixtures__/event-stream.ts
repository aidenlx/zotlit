import { Effect, Queue, Stream } from "@/lib/effect";
import type { Cause, Fiber } from "@/lib/effect";

/** A controlled event source at a consumer fixture's Stream boundary. */
export function testEvent<A>() {
  const queues = new Set<Queue.Queue<A, Cause.Done>>();
  const fibers = new Set<Fiber.Fiber<unknown, unknown>>();
  return {
    get subscribers() {
      return queues.size;
    },
    stream: Stream.unwrap(
      Effect.map(
        Effect.acquireRelease(
          Effect.gen(function* () {
            const queue = yield* Queue.unbounded<A, Cause.Done>();
            const fiber = yield* Effect.withFiberSucceed((fiber) => fiber);
            queues.add(queue);
            fibers.add(fiber);
            return { queue, fiber };
          }),
          ({ queue, fiber }) =>
            Effect.sync(() => {
              queues.delete(queue);
              fibers.delete(fiber);
              Queue.endUnsafe(queue);
            }),
        ),
        ({ queue }) => Stream.fromQueue(queue),
      ),
    ),
    emit(value: A): void {
      for (const queue of queues) Queue.offerUnsafe(queue, value);
      // Fixture publication completes runnable deliveries; async handlers still
      // expose their own completion signal to the test.
      for (const fiber of fibers) fiber.currentDispatcher.flush();
    },
  };
}

type EventsShape<Events> = {
  [K in keyof Events]: (...args: never[]) => unknown;
};
type EventValue<F extends (...args: never[]) => unknown> =
  Parameters<F> extends []
    ? void
    : Parameters<F> extends [infer A]
      ? A
      : Parameters<F>;

/** Named native Streams with controlled event publication for consumer tests. */
export function testEvents<Events extends EventsShape<Events>>(
  names: readonly (keyof Events)[],
) {
  const sources = new Map<
    keyof Events,
    ReturnType<typeof testEvent<unknown>>
  >();
  const streams = Object.fromEntries(
    names.map((name) => {
      const source = testEvent<unknown>();
      sources.set(name, source);
      return [name, source.stream];
    }),
  ) as { readonly [K in keyof Events]: Stream.Stream<EventValue<Events[K]>> };
  return {
    streams,
    subscribers(name: keyof Events) {
      return sources.get(name)?.subscribers ?? 0;
    },
    emit<K extends keyof Events>(name: K, ...args: Parameters<Events[K]>) {
      sources.get(name)!.emit(args.length > 1 ? args : args[0]);
    },
  };
}
