import { Clock, Context, Effect, Exit, Layer, Scope } from "effect";
// A real QueryClients layer for consumer tests outside Effect.
import { TestClock } from "effect/testing";

import { effectBridge } from "@/lib/effect-bridge";
import type { EffectBridge } from "@/lib/effect-bridge";
import { buildRuntime } from "@/lib/effect-layer";

import { QueryClients } from "./service";
import { layerQueryClients } from "./service";
import type { TestClock as QueryTestClock } from "./test-clock";

export function buildQueryClients(
  stack: AsyncDisposableStack,
  now?: QueryTestClock["now"],
): QueryClients["Service"] & {
  runtime: import("@/lib/effect-stream").SubscriptionRuntime;
  bridge: EffectBridge;
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
  return Object.assign(runtime.runSync(QueryClients), {
    runtime,
    bridge: effectBridge(runtime),
  });
}

/** A consumer fixture whose owner disposes its runtime. */
export function queryClientsFixture(
  now?: QueryTestClock["now"],
): QueryClients["Service"] &
  AsyncDisposable & {
    runtime: import("@/lib/effect-stream").SubscriptionRuntime;
    bridge: EffectBridge;
  } {
  const stack = new AsyncDisposableStack();
  return Object.assign(buildQueryClients(stack, now), {
    [Symbol.asyncDispose]: () => stack.disposeAsync(),
  });
}

/** The native QueryClients on this test's Clock, with its runtime and bridge; the test Scope owns the runtime. */
export const queryClientsOf = Effect.fn("queryClientsOf")(function* () {
  const context = yield* Effect.context<never>();
  const scope = yield* Effect.acquireRelease(Scope.make(), (scope) =>
    Scope.close(scope, Exit.void),
  );
  const services = yield* Layer.buildWithScope(layerQueryClients, scope);
  const { runtime } = yield* Effect.acquireDisposable(
    Effect.tryPromise(() => openTestRuntime(Context.merge(context, services))),
  );
  return Object.assign(runtime.runSync(QueryClients), {
    runtime,
    bridge: effectBridge(runtime),
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
