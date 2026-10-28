import { it } from "@effect/vitest";
import { Deferred, Effect, Exit, Fiber, Layer } from "effect";
import { expect } from "vitest";

import { layerHost } from "@/lib/__fixtures__/obsidian-host-app";
import {
  layerUnreadViewServices,
  scopedViewRegistry,
} from "@/lib/__fixtures__/view-atoms";
import { scopedViewRunner } from "@/lib/__fixtures__/view-runner";
import { Release } from "@/services/release/service";

import {
  answerOf,
  inFlightSlot,
  joinOnView,
  makeViewRunner,
} from "./view-runner";
import type { InFlightSlot } from "./view-runner";

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

it.effect(
  "settles once no Effect it runs is running, and at once after the view closes",
  () =>
    Effect.gen(function* () {
      const registry = yield* scopedViewRegistry(
        yield* Layer.build(layerServices),
      );
      const runner = makeViewRunner(registry);
      const finish = yield* Deferred.make<void>();
      runner.run(Deferred.await(finish));
      let settled = false;
      const waiting = runner.settled().then(() => {
        settled = true;
      });
      yield* Effect.yieldNow;
      expect(settled).toBe(false);
      yield* Deferred.succeed(finish, undefined);
      yield* Effect.promise(() => waiting);
      expect(settled).toBe(true);
      runner.run(Effect.never);
      yield* Effect.promise(() => runner[Symbol.asyncDispose]());
      yield* Effect.promise(() => runner.settled());
    }).pipe(Effect.scoped),
);

/** A runner over the test services, closed with the test's Scope. */
const scopedRunner = Effect.flatMap(
  Effect.flatMap(Layer.build(layerServices), (context) =>
    scopedViewRegistry(context),
  ),
  (registry) => scopedViewRunner(registry),
);

it.effect("interrupts the run on the view when its caller is interrupted", () =>
  Effect.gen(function* () {
    const runner = yield* scopedRunner;
    const started = yield* Deferred.make<void>();
    let stopped = false;
    const caller = yield* Effect.forkChild(
      joinOnView(
        runner.run,
        Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Effect.never),
          Effect.onInterrupt(() =>
            Effect.sync(() => {
              stopped = true;
            }),
          ),
        ),
      ),
    );
    yield* Deferred.await(started);
    yield* Fiber.interrupt(caller);
    yield* Effect.promise(() => runner.settled());
    expect(stopped).toBe(true);
  }).pipe(Effect.scoped),
);

it.effect("interrupts the caller of a run when the view closes", () =>
  Effect.gen(function* () {
    const registry = yield* scopedViewRegistry(
      yield* Layer.build(layerServices),
    );
    const runner = makeViewRunner(registry);
    const started = yield* Deferred.make<void>();
    const caller = yield* Effect.forkChild(
      joinOnView(
        runner.run,
        Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
      ),
    );
    yield* Deferred.await(started);
    yield* Effect.promise(() => runner[Symbol.asyncDispose]());
    expect(Exit.hasInterrupts(yield* Fiber.await(caller))).toBe(true);
  }).pipe(Effect.scoped),
);

it.effect("shares one run between the callers that join while it runs", () =>
  Effect.gen(function* () {
    const runner = yield* scopedRunner;
    const finish = yield* Deferred.make<string>();
    let runs = 0;
    const changes: boolean[] = [];
    let running = () => false;
    const slot: InFlightSlot<string, never> = inFlightSlot(
      runner.run,
      Effect.suspend(() => {
        runs++;
        return Deferred.await(finish);
      }),
      () => changes.push(running()),
    );
    running = slot.running;
    const first = yield* Effect.forkChild(slot.join);
    const second = yield* Effect.forkChild(slot.join);
    yield* Effect.yieldNow;
    expect(slot.running()).toBe(true);
    yield* Deferred.succeed(finish, "done");
    expect(yield* Fiber.join(first)).toBe("done");
    expect(yield* Fiber.join(second)).toBe("done");
    expect(runs).toBe(1);
    // onChange fires once when the run starts and once when it ends.
    expect(changes).toEqual([true, false]);
    expect(slot.running()).toBe(false);
    // A join after the run ended starts a new run.
    yield* Effect.forkChild(slot.join);
    yield* Effect.yieldNow;
    expect(runs).toBe(2);
  }).pipe(Effect.scoped),
);

it.effect("frees the slot of a run the closed view ends at once", () =>
  Effect.gen(function* () {
    const registry = yield* scopedViewRegistry(
      yield* Layer.build(layerServices),
    );
    const runner = makeViewRunner(registry);
    yield* Effect.promise(() => runner[Symbol.asyncDispose]());
    const changes: boolean[] = [];
    let running = () => false;
    const slot = inFlightSlot(runner.run, Effect.void, () =>
      changes.push(running()),
    );
    running = slot.running;
    slot.start();
    expect(changes).toEqual([true, false]);
    expect(slot.running()).toBe(false);
  }).pipe(Effect.scoped),
);

it.effect(
  "answers a run's value, its release value on an interrupt, and throws its failure",
  () =>
    Effect.gen(function* () {
      const runner = yield* scopedRunner;
      expect(
        yield* Effect.promise(() =>
          answerOf(runner.run(Effect.succeed("value")), "released"),
        ),
      ).toBe("value");
      expect(
        yield* Effect.promise(() =>
          answerOf(runner.run(Effect.interrupt), "released"),
        ),
      ).toBe("released");
      const failure = new Error("disk full");
      const thrown = yield* Effect.promise(() =>
        answerOf(runner.run(Effect.fail(failure)), "released").then(
          () => null,
          (error: unknown) => error,
        ),
      );
      expect(thrown).toBe(failure);
    }).pipe(Effect.scoped),
);
