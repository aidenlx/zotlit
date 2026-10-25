import type { QueryFunction, QueryKey } from "@tanstack/query-core";
import { Clock, Context, Effect, Exit, Layer, Scope } from "effect";
// A real QueryClients layer for consumer tests outside Effect.
import { TestClock } from "effect/testing";

import { buildRuntime } from "@/lib/effect-layer";

import { plainQueryClients } from "./plain";
import type { PlainQueryClients } from "./plain";
import type { QueryClients } from "./service";
import type { HeldReadEvents } from "./service";
import { layerQueryClients } from "./service";

/** A plain test client with the Effect surface `ExcerptDisplayService` reads. */
export function taggedQueryClients(
  queries: PlainQueryClients,
): Pick<
  QueryClients["Service"],
  "client" | "invalidate" | "peek" | "read" | "watch"
> {
  return {
    client: queries.client,
    invalidate: (key) => Effect.sync(() => queries.invalidate(key)),
    peek: <T>(key: QueryKey) => Effect.sync(() => queries.peek<T>(key)),
    read: <T>(key: QueryKey, queryFn: QueryFunction<T>) =>
      Effect.tryPromise({
        try: (signal) => queries.read(key, queryFn, signal),
        catch: (error) => error,
      }),
    watch: <T>(prefix: QueryKey, on: HeldReadEvents<T>) =>
      Effect.sync(() => queries.watch(prefix, on)),
  };
}

export function buildQueryClients(
  stack: AsyncDisposableStack,
  now?: () => Temporal.Instant,
): PlainQueryClients & {
  runtime: import("@/lib/effect-stream").SubscriptionRuntime;
} {
  const clock = Context.get(Context.empty(), Clock.Clock);
  const layer =
    now === undefined
      ? layerQueryClients
      : layerQueryClients.pipe(
          Layer.provide(
            Layer.succeed(Clock.Clock, {
              currentTimeNanosUnsafe: () => now().epochNanoseconds,
              currentTimeNanos: Effect.sync(() => now().epochNanoseconds),
              monotonicTimeNanosUnsafe: () => clock.monotonicTimeNanosUnsafe(),
              monotonicTimeNanos: clock.monotonicTimeNanos,
              sleep: (duration) => clock.sleep(duration),
              currentTimeMillisUnsafe: () => now().epochMilliseconds,
              currentTimeMillis: Effect.sync(() => now().epochMilliseconds),
            }),
          ),
        );
  const runtime = buildRuntime(layer, stack);
  return Object.assign(plainQueryClients(runtime), { runtime });
}

/** A consumer fixture whose owner disposes its runtime. */
export function queryClientsFixture(
  now?: () => Temporal.Instant,
): PlainQueryClients &
  AsyncDisposable & {
    runtime: import("@/lib/effect-stream").SubscriptionRuntime;
  } {
  const stack = new AsyncDisposableStack();
  return Object.assign(buildQueryClients(stack, now), {
    [Symbol.asyncDispose]: () => stack.disposeAsync(),
  });
}

/** A plain adapter on this test's Clock; the test Scope owns its runtime. */
export const queryClientsOf = Effect.fn("queryClientsOf")(function* () {
  const context = yield* Effect.context<never>();
  const scope = yield* Effect.acquireRelease(Scope.make(), (scope) =>
    Scope.close(scope, Exit.void),
  );
  const services = yield* Layer.buildWithScope(layerQueryClients, scope);
  const { runtime } = yield* Effect.acquireDisposable(
    Effect.tryPromise(() => openTestRuntime(Context.merge(context, services))),
  );
  return Object.assign(plainQueryClients(runtime), {
    runtime,
    passCooldown: () =>
      runtime.runPromise(
        TestClock.adjust(5001).pipe(Effect.provideContext(context)),
      ),
    [Symbol.asyncDispose]: () =>
      runtime.runPromise(Scope.close(scope, Exit.void)),
  });
});

async function openTestRuntime(context: Context.Context<QueryClients>) {
  await using stack = new AsyncDisposableStack();
  const runtime = buildRuntime(Layer.succeedContext(context), stack);
  const owned = stack.move();
  return { runtime, [Symbol.asyncDispose]: () => owned.disposeAsync() };
}
