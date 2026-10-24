// A real QueryClients layer for consumer tests outside Effect.
import { TestClock } from "effect/testing";

import { Clock, Context, Effect, Exit, Layer, Scope } from "@/lib/effect";
import { buildRuntime } from "@/lib/effect-layer";
import { acquireAsyncDisposable } from "@/lib/effect-scope";

import { plainQueryClients } from "./plain";
import type { PlainQueryClients } from "./plain";
import type { QueryClients } from "./service";
import { layerQueryClients } from "./service";

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
  const { runtime } = yield* acquireAsyncDisposable(() =>
    openTestRuntime(Context.merge(context, services)),
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
