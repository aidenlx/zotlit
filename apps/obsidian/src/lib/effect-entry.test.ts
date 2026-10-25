// Guards the `effectEntry` plugin in vitest.config.ts: plugin code imports the
// package names, and only the plugin's redirect gives them the wrappers.
import { it as effectIt } from "@effect/vitest";
import { Context, Effect, Logger, Tracer } from "effect";
import { Scheduler } from "effect/Scheduler";
import { expect, it } from "vitest";

import { browserScheduler } from "./browser-scheduler";
import { logTapeLogger } from "./effect-log";

// Failure mode: the redirect is gone, so `Effect.runSync` from `effect` runs
// with Node's scheduler, Effect's console logger and trace propagation.
it("runs Effect.runSync from effect with the runtime services", () => {
  const services = Effect.runSync(Effect.context<never>());
  expect(Context.get(services, Scheduler)).toBe(browserScheduler);
  expect(Context.get(services, Logger.CurrentLoggers)).toContain(logTapeLogger);
  expect(Context.get(services, Tracer.DisablePropagation)).toBe(true);
});

effectIt.effect(
  "runs it.effect from @effect/vitest with the browser scheduler",
  () =>
    Effect.gen(function* () {
      expect(yield* Scheduler).toBe(browserScheduler);
    }),
);
