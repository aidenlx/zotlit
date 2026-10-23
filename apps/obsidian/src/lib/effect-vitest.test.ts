import { Scheduler } from "effect/Scheduler";
import { TestClock } from "effect/testing";

import { browserScheduler } from "./browser-scheduler";
import { Clock, Context, Effect, Layer } from "./effect";
import { describe, expect, it, layer } from "./effect-vitest";

class Probe extends Context.Service<Probe, number>()(
  "zotlit/effect-vitest/Probe",
) {}

const scheduler = Effect.gen(function* () {
  yield* Effect.yieldNow;
  expect(yield* Scheduler).toBe(browserScheduler);
});

// Failure modes: a tester, a modifier, or a layer-wrapped `it` runs the body
// on Effect's default scheduler, or the wrapper drops the test services.
describe("Effect tests", () => {
  it.effect("run on the browser scheduler", () => scheduler);
  it.live("run live on the browser scheduler", () => scheduler);
  it.effect.each([1, 2])(
    "run each case on the browser scheduler",
    () => scheduler,
  );

  it.effect("keep the test clock", () =>
    Effect.gen(function* () {
      yield* TestClock.adjust("1 minute");
      const clock = yield* Clock.Clock;
      expect(clock.currentTimeMillisUnsafe()).toBe(60_000);
    }),
  );

  layer(Layer.succeed(Probe, 1))("in a layer", (it) => {
    it.effect("run on the browser scheduler with its services", () =>
      Effect.gen(function* () {
        expect(yield* Probe).toBe(1);
        yield* scheduler;
      }),
    );
    it.layer(Layer.succeed(Probe, 2))("nested", (it) => {
      it.effect("run on the browser scheduler with the inner services", () =>
        Effect.gen(function* () {
          expect(yield* Probe).toBe(2);
          yield* scheduler;
        }),
      );
    });
  });
});
