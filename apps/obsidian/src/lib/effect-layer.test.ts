import { it } from "@effect/vitest";
import { Context, Deferred, Effect, Fiber, Layer } from "effect";
import { Scheduler } from "effect/Scheduler";
import { TestClock } from "effect/testing";
import { expect } from "vitest";

import { ServiceContainer } from "@/services/service-base";

import { browserScheduler } from "./browser-scheduler";
import { buildRuntime } from "./effect-layer";

class Probe extends Context.Service<Probe, { value: number }>()(
  "zotlit/effect-layer/Probe",
) {}

// Failure mode: work run through the plugin's runtime falls back to Effect's
// default scheduler, which Obsidian throttles in a hidden window.
it.effect("runs its fibers on the browser scheduler", () =>
  Effect.gen(function* () {
    const stack = yield* Effect.acquireDisposable(
      Effect.tryPromise(async () => new AsyncDisposableStack()),
    );
    const runtime = buildRuntime(Layer.succeed(Probe, { value: 1 }), stack);

    const scheduler = yield* Effect.promise(() =>
      runtime.runPromise(Scheduler),
    );

    expect(scheduler).toBe(browserScheduler);
  }),
);

// #1705: the container must read settled state after async layer acquisition.
it.effect("reads the loaded value synchronously after the graph builds", () =>
  Effect.gen(function* () {
    const context = yield* Effect.context<never>();
    const started = yield* Deferred.make<void>();
    const probe = { value: 0 };
    const layer = Layer.effect(
      Probe,
      Effect.gen(function* () {
        yield* Deferred.succeed(started, undefined);
        yield* Effect.sleep("1 second");
        probe.value = 42;
        return probe;
      }),
    ).pipe(Layer.provide(Layer.succeedContext(context)));

    const pending = yield* Effect.forkChild(
      Effect.promise(async () => {
        await using stack = new AsyncDisposableStack();
        const runtime = buildRuntime(layer, stack);
        await runtime.context();
        const container = new ServiceContainer(stack, () => {}).useValue({
          probe: () => runtime.runSync(Probe.use(Effect.succeed)),
        });
        return container.services.probe.value;
      }),
    );

    yield* Deferred.await(started);
    expect(probe.value).toBe(0);
    yield* TestClock.adjust("1 second");

    expect(yield* Fiber.join(pending)).toBe(42);
  }),
);

// #1705: onload's await-using boundary must roll back a failed graph and
// propagate its error to Obsidian before startup can commit.
it.effect("unwinds the startup stack before rejecting a failed graph", () =>
  Effect.gen(function* () {
    const error = new Error("first load failed");
    const released: string[] = [];
    const layer = Layer.effect(
      Probe,
      Effect.gen(function* () {
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            released.push("layer");
          }),
        );
        yield* Effect.promise(() => Promise.resolve());
        return yield* Effect.die(error);
      }),
    );

    const rejected = yield* Effect.flip(
      Effect.tryPromise(async () => {
        await using stack = new AsyncDisposableStack();
        stack.defer(() => {
          released.push("startup");
        });
        const runtime = buildRuntime(layer, stack);
        await runtime.context();
      }),
    );

    expect(rejected.cause).toBe(error);
    expect(released).toEqual(["layer", "startup"]);
  }),
);
