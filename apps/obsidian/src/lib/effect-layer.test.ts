import { Scheduler } from "effect/Scheduler";
import { expect, it, vi } from "vitest";

import { Context, Effect, Layer } from "@/lib/effect";

import { browserScheduler } from "./browser-scheduler";
import { buildRuntime } from "./effect-layer";

class Probe extends Context.Service<Probe, number>()(
  "zotlit/effect-layer/Probe",
) {}

// Failure mode: work run through the plugin's runtime falls back to Effect's
// default scheduler, which Obsidian throttles in a hidden window.
it("runs its fibers on the browser scheduler", async () => {
  await using stack = new AsyncDisposableStack();
  const runtime = buildRuntime(Layer.succeed(Probe, 1), stack);

  const scheduler = await runtime.runPromise(
    Effect.gen(function* () {
      return yield* Scheduler;
    }),
  );

  expect(scheduler).toBe(browserScheduler);
});

// Failure modes: a layer that suspends hangs plugin load, or leaves what it
// acquired before suspending held after the build fails.
it("throws on a layer that suspends and releases what it acquired", async () => {
  const released = vi.fn();
  const layer = Layer.effect(
    Probe,
    Effect.gen(function* () {
      yield* Effect.addFinalizer(() => Effect.sync(released));
      return yield* Effect.promise(() => Promise.resolve(1));
    }),
  );
  const stack = new AsyncDisposableStack();

  expect(() => buildRuntime(layer, stack)).toThrow();
  await stack.disposeAsync();

  expect(released).toHaveBeenCalledOnce();
});
