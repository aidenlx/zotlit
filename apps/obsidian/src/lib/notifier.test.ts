import { it } from "@effect/vitest";
import { Effect, Exit, Scope } from "effect";
import { describe, expect } from "vitest";

import { testNotifier } from "./__fixtures__/notifier";
import { Notifier } from "./notifier";

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
