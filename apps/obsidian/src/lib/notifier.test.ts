import { it } from "@effect/vitest";
import { Effect, Exit, Fiber, Scope } from "effect";
import { describe, expect } from "vitest";

import { testNotifier } from "./__fixtures__/notifier";
import { AbortError } from "./abort-error";
import { Notifier, reportOutcome } from "./notifier";

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
