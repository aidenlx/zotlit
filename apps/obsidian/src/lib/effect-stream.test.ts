import { expect } from "vitest";

import {
  Cause,
  Context,
  Effect,
  Layer,
  Logger,
  ManagedRuntime,
  PubSub,
  Queue,
  Stream,
  SubscriptionRef,
} from "@/lib/effect";
import { LogCategory } from "@/lib/effect-log";
import { subscribe } from "@/lib/effect-stream";
import { it } from "@/lib/effect-vitest";

// #1705: a callback defect belongs to one delivery, not the subscription.
it.effect(
  "logs a throwing listener's cause and still delivers the next value",
  () =>
    Effect.gen(function* () {
      const error = new Error("listener failed");
      const logs: {
        cause: Cause.Cause<unknown>;
        category: readonly string[];
      }[] = [];
      const context = (yield* Effect.context<never>()).pipe(
        Context.add(
          Logger.CurrentLoggers,
          new Set([
            Logger.make(({ cause, fiber }) => {
              logs.push({ cause, category: fiber.getRef(LogCategory) });
            }),
          ]),
        ),
      );
      const runtime = yield* Effect.acquireRelease(
        Effect.sync(() => ManagedRuntime.make(Layer.succeedContext(context))),
        (runtime) => runtime.disposeEffect,
      );
      const finished = yield* Queue.unbounded<void>();
      const received: number[] = [];
      subscribe(
        runtime,
        Stream.make(1, 2).pipe(
          Stream.ensuring(Queue.offer(finished, undefined)),
        ),
        (value) => {
          received.push(value);
          if (value === 1) throw error;
        },
      );
      yield* Queue.take(finished);
      expect(received).toEqual([1, 2]);
      expect(logs).toHaveLength(1);
      expect(Cause.squash(logs[0]!.cause)).toBe(error);
      expect(logs[0]!.category).toEqual(["effect-stream"]);
    }),
);

// #1705: interruptWhen starts an upstream fiber; latest-value replay loses earlier edits.
it.effect(
  "attaches before two immediate changes and stops on unsubscribe",
  () =>
    Effect.gen(function* () {
      const context = yield* Effect.context<never>();
      const runtime = yield* Effect.acquireRelease(
        Effect.sync(() => ManagedRuntime.make(Layer.succeedContext(context))),
        (runtime) => runtime.disposeEffect,
      );
      const state = yield* SubscriptionRef.make(0);
      const received: number[] = [];
      const delivered = yield* Queue.unbounded<void>();
      const stop = subscribe(
        runtime,
        SubscriptionRef.changes(state).pipe(
          Stream.interruptWhen(Effect.never),
          Stream.filter((value) => value > 0),
        ),
        (value) => {
          received.push(value);
          if (value === 2) Queue.offerUnsafe(delivered, undefined);
        },
      );
      runtime.runSync(SubscriptionRef.set(state, 1));
      runtime.runSync(SubscriptionRef.set(state, 2));
      yield* Queue.take(delivered);
      expect(received).toEqual([1, 2]);
      stop();
      stop();
      runtime.runSync(SubscriptionRef.set(state, 3));
      yield* runtime.disposeEffect;
      expect(received).toEqual([1, 2]);
    }),
);

it.effect("subscribe after runtime disposal is a no-op", () =>
  Effect.gen(function* () {
    const context = yield* Effect.context<never>();
    const runtime = yield* Effect.acquireRelease(
      Effect.sync(() => ManagedRuntime.make(Layer.succeedContext(context))),
      (runtime) => runtime.disposeEffect,
    );
    yield* runtime.disposeEffect;
    let started = false;
    let called = false;
    // A closed runtime must not even start a subscription fiber.
    const closedRuntime: Pick<typeof runtime, "scope" | "runFork"> = {
      scope: runtime.scope,
      runFork: (effect, options) => {
        started = true;
        return runtime.runFork(effect, options);
      },
    };
    expect(() =>
      subscribe(closedRuntime, Stream.succeed(1), () => {
        called = true;
      })(),
    ).not.toThrow();
    expect(started).toBe(false);
    expect(called).toBe(false);
  }),
);

it.effect("runtime interruption closes an active subscription", () =>
  Effect.gen(function* () {
    const context = yield* Effect.context<never>();
    const runtime = yield* Effect.acquireRelease(
      Effect.sync(() => ManagedRuntime.make(Layer.succeedContext(context))),
      (runtime) => runtime.disposeEffect,
    );
    const bus = yield* PubSub.unbounded<number>();
    const delivered = yield* Queue.unbounded<void>();
    const finished = yield* Queue.unbounded<void>();
    const received: number[] = [];
    const stop = subscribe(
      runtime,
      Stream.fromPubSub(bus).pipe(
        Stream.ensuring(Queue.offer(finished, undefined)),
      ),
      (value) => {
        received.push(value);
        Queue.offerUnsafe(delivered, undefined);
      },
    );
    yield* PubSub.publish(bus, 1);
    yield* Queue.take(delivered);
    yield* runtime.disposeEffect;
    yield* Queue.take(finished);
    yield* PubSub.publish(bus, 2);
    stop();
    expect(received).toEqual([1]);
  }),
);
