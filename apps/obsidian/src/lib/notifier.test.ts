import { it } from "@effect/vitest";
import { Effect, Exit, Fiber, Layer, Scope } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect } from "vitest";

import { testNotifier } from "./__fixtures__/notifier";
import { AbortError } from "./abort-error";
import { Notifier, reportOutcome, withProgress } from "./notifier";

describe("Notifier test layer", () => {
  it.effect("records a shown notice with its duration until it hides", () =>
    Effect.gen(function* () {
      const notifier = testNotifier();
      const notice = yield* Notifier.use((n) =>
        n.show("Refreshed", { duration: 2000 }),
      ).pipe(Effect.provide(notifier.layer));

      expect(notifier.notices).toEqual([
        { messages: ["Refreshed"], duration: 2000, hidden: false },
      ]);
      yield* notice.setMessage("Refreshed again");
      yield* notice.hide;
      expect(notifier.notices).toEqual([
        {
          messages: ["Refreshed", "Refreshed again"],
          duration: 2000,
          hidden: true,
        },
      ]);
    }),
  );

  it.effect(
    "shows a progress notice on its first message and hides it on release",
    () =>
      Effect.gen(function* () {
        const notifier = testNotifier();
        const scope = yield* Scope.fork(yield* Effect.scope);
        const progress = yield* Notifier.use((n) => n.progress).pipe(
          Effect.provide(notifier.layer),
          Scope.provide(scope),
        );

        expect(notifier.notices).toEqual([]);
        yield* progress.setMessage("Refreshing");
        yield* progress.setMessage("Refreshed");
        expect(notifier.notices).toEqual([
          { messages: ["Refreshing", "Refreshed"], duration: 0, hidden: false },
        ]);

        yield* Scope.close(scope, Exit.void);
        expect(notifier.notices[0]?.hidden).toBe(true);
      }),
  );

  it.effect("shows nothing for a progress notice that got no message", () =>
    Effect.gen(function* () {
      const notifier = testNotifier();
      yield* Effect.scoped(
        Notifier.use((n) => n.progress).pipe(Effect.provide(notifier.layer)),
      );
      expect(notifier.notices).toEqual([]);
    }),
  );
});

describe("reportOutcome", () => {
  const copy = {
    success: (result: string) =>
      result === "" ? undefined : `Done: ${result}`,
    error: (error: unknown) => `Failed: ${String(error)}`,
  };

  it.effect("shows the success message for 2 seconds", () =>
    Effect.gen(function* () {
      const notifier = testNotifier();
      yield* reportOutcome(Effect.succeed("Methods"), copy).pipe(
        Effect.provide(notifier.layer),
      );
      expect(notifier.notices).toEqual([
        { messages: ["Done: Methods"], duration: 2000, hidden: false },
      ]);
    }),
  );

  it.effect("shows nothing for a result without a message", () =>
    Effect.gen(function* () {
      const notifier = testNotifier();
      yield* reportOutcome(Effect.succeed(""), copy).pipe(
        Effect.provide(notifier.layer),
      );
      expect(notifier.notices).toEqual([]);
    }),
  );

  it.effect("shows the error message for 4 seconds", () =>
    Effect.gen(function* () {
      const notifier = testNotifier();
      yield* reportOutcome(Effect.fail("disk full"), copy).pipe(
        Effect.provide(notifier.layer),
      );
      expect(notifier.notices).toEqual([
        { messages: ["Failed: disk full"], duration: 4000, hidden: false },
      ]);
    }),
  );

  it.effect("shows nothing when the task aborts", () =>
    Effect.gen(function* () {
      const notifier = testNotifier();
      yield* reportOutcome(Effect.die(new AbortError("Cancelled")), copy).pipe(
        Effect.provide(notifier.layer),
      );
      expect(notifier.notices).toEqual([]);
    }),
  );

  it.effect("passes an interrupt on without a notice", () =>
    Effect.gen(function* () {
      const notifier = testNotifier();
      const fiber = yield* reportOutcome(Effect.never, copy).pipe(
        Effect.provide(notifier.layer),
        Effect.forkChild,
      );
      yield* Effect.yieldNow;
      yield* Fiber.interrupt(fiber);
      const exit = yield* Fiber.await(fiber);
      expect(Exit.hasInterrupts(exit)).toBe(true);
      expect(notifier.notices).toEqual([]);
    }),
  );
});

describe("withProgress", () => {
  const copy = {
    loading: "Creating",
    success: (result: string) => `Created ${result}`,
    error: "Failed",
  };

  it.effect(
    "returns the task's result while its notice stays, until the Notifier's layer closes",
    () =>
      Effect.gen(function* () {
        const notifier = testNotifier();
        const scope = yield* Scope.make();
        const context = yield* Layer.buildWithScope(notifier.layer, scope);
        const task = Effect.sleep("1 second").pipe(Effect.as("Paper"));
        const fiber = yield* withProgress(task, copy).pipe(
          Effect.provideContext(context),
          Effect.forkChild,
        );
        yield* TestClock.adjust("1 second");

        expect(yield* Fiber.join(fiber)).toBe("Paper");
        yield* Effect.yieldNow;
        // The notice outlives the task: it shows the result for 2 s.
        expect(notifier.notices).toEqual([
          {
            messages: ["Creating", "Created Paper"],
            duration: 0,
            hidden: false,
          },
        ]);
        // Unload closes the layer, which ends the notice before its 2 s.
        yield* Scope.close(scope, Exit.void);
        expect(notifier.notices[0]?.hidden).toBe(true);
      }),
  );

  it.effect("shows no success message for an interrupted task", () =>
    Effect.gen(function* () {
      const notifier = testNotifier();
      const fiber = yield* withProgress(Effect.never, {
        ...copy,
        success: "Created",
      }).pipe(Effect.provide(notifier.layer), Effect.forkChild);
      yield* TestClock.adjust("200 millis");
      expect(notifier.notices).toEqual([
        { messages: ["Creating"], duration: 0, hidden: false },
      ]);

      yield* Fiber.interrupt(fiber);
      // Past the success message's 2 s, so the notice has ended either way.
      yield* TestClock.adjust("2 seconds");

      expect(notifier.notices).toEqual([
        { messages: ["Creating"], duration: 0, hidden: true },
      ]);
    }),
  );

  it.effect("shows only the result for a task done within 200 ms", () =>
    Effect.gen(function* () {
      const notifier = testNotifier();
      const context = yield* Layer.build(notifier.layer);
      yield* withProgress(Effect.succeed("Paper"), copy).pipe(
        Effect.provideContext(context),
      );
      yield* TestClock.adjust("200 millis");

      expect(notifier.notices).toEqual([
        { messages: ["Created Paper"], duration: 0, hidden: false },
      ]);
    }),
  );

  it.effect(
    "shows no success message for a result without one, and hides the loading message",
    () =>
      Effect.gen(function* () {
        const notifier = testNotifier();
        const context = yield* Layer.build(notifier.layer);
        const task = Effect.sleep("1 second").pipe(Effect.as(""));
        const fiber = yield* withProgress(task, {
          ...copy,
          success: (result: string) =>
            result === "" ? undefined : `Created ${result}`,
        }).pipe(Effect.provideContext(context), Effect.forkChild);
        yield* TestClock.adjust("1 second");
        yield* Fiber.join(fiber);
        yield* Effect.yieldNow;

        expect(notifier.notices).toEqual([
          { messages: ["Creating"], duration: 0, hidden: true },
        ]);
      }),
  );

  it.effect("hides the success message after 2 seconds", () =>
    Effect.gen(function* () {
      const notifier = testNotifier();
      const context = yield* Layer.build(notifier.layer);
      yield* withProgress(Effect.succeed("Paper"), copy).pipe(
        Effect.provideContext(context),
      );
      yield* Effect.yieldNow;

      yield* TestClock.adjust("1999 millis");
      expect(notifier.notices[0]?.hidden).toBe(false);
      yield* TestClock.adjust("1 millis");
      expect(notifier.notices[0]?.hidden).toBe(true);
    }),
  );

  it.effect("shows the error message for 4 seconds", () =>
    Effect.gen(function* () {
      const notifier = testNotifier();
      const context = yield* Layer.build(notifier.layer);
      yield* withProgress(Effect.fail("disk full"), copy).pipe(
        Effect.provideContext(context),
        Effect.ignore,
      );
      yield* Effect.yieldNow;

      expect(notifier.notices).toEqual([
        { messages: ["Failed"], duration: 0, hidden: false },
      ]);
      yield* TestClock.adjust("3999 millis");
      expect(notifier.notices[0]?.hidden).toBe(false);
      yield* TestClock.adjust("1 millis");
      expect(notifier.notices[0]?.hidden).toBe(true);
    }),
  );
});
