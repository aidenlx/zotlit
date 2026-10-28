import { it } from "@effect/vitest";
import { Deferred, Effect, Exit, Fiber, Layer } from "effect";
import { expect } from "vitest";

import { layerHost } from "@/lib/__fixtures__/obsidian-host-app";
import {
  layerUnreadViewServices,
  scopedViewRegistry,
} from "@/lib/__fixtures__/view-atoms";
import { Release } from "@/services/release/service";

import { makeViewRunner } from "./view-runner";

const layerServices = Layer.mergeAll(
  layerUnreadViewServices,
  layerHost(),
  Layer.mock(Release, { version: "1.2.3" }),
);

it.effect("runs an Effect on the view services of the registry", () =>
  Effect.gen(function* () {
    const registry = yield* scopedViewRegistry(
      yield* Layer.build(layerServices),
    );
    using runner = makeViewRunner(registry);
    const fiber = runner.run(Effect.map(Release, (r) => r.version));
    expect(yield* Fiber.join(fiber)).toBe("1.2.3");
  }).pipe(Effect.scoped),
);

it.effect("interrupts every running Effect when the view closes", () =>
  Effect.gen(function* () {
    const registry = yield* scopedViewRegistry(
      yield* Layer.build(layerServices),
    );
    const runner = makeViewRunner(registry);
    const started = yield* Deferred.make<void>();
    const fibers = [1, 2].map(() =>
      runner.run(
        Effect.andThen(Deferred.succeed(started, undefined), Effect.never),
      ),
    );
    yield* Deferred.await(started);
    runner[Symbol.dispose]();
    for (const fiber of fibers) {
      const exit = yield* Fiber.await(fiber);
      expect(Exit.hasInterrupts(exit)).toBe(true);
    }
  }).pipe(Effect.scoped),
);
