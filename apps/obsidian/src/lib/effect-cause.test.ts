import { describe, expect, it } from "@effect/vitest";
import { Cause, Effect, Exit } from "effect";

import { recover } from "./effect-cause";

describe("recover", () => {
  it.effect("answers the value of an Effect that succeeds", () =>
    Effect.gen(function* () {
      const logged: Cause.Cause<unknown>[] = [];
      const answer = yield* Effect.succeed(1).pipe(
        recover(
          (cause) => Effect.sync(() => logged.push(cause)),
          Effect.succeed("fallback"),
        ),
      );

      expect(answer).toBe(1);
      expect(logged).toEqual([]);
    }),
  );

  it.effect("logs a failure and answers the fallback", () =>
    Effect.gen(function* () {
      const logged: Cause.Cause<unknown>[] = [];
      const answer = yield* Effect.fail("broken").pipe(
        recover(
          (cause) => Effect.sync(() => logged.push(cause)),
          Effect.succeed("fallback"),
        ),
      );

      expect(answer).toBe("fallback");
      expect(logged.map(Cause.squash)).toEqual(["broken"]);
    }),
  );

  it.effect("logs a defect and answers the fallback", () =>
    Effect.gen(function* () {
      const logged: Cause.Cause<unknown>[] = [];
      const answer = yield* Effect.die("defect").pipe(
        recover(
          (cause) => Effect.sync(() => logged.push(cause)),
          Effect.succeed("fallback"),
        ),
      );

      expect(answer).toBe("fallback");
      expect(logged.map(Cause.squash)).toEqual(["defect"]);
    }),
  );

  it.effect("lets an interrupt through, unlogged", () =>
    Effect.gen(function* () {
      const logged: Cause.Cause<unknown>[] = [];
      const exit = yield* Effect.exit(
        Effect.interrupt.pipe(
          recover(
            (cause) => Effect.sync(() => logged.push(cause)),
            Effect.succeed("fallback"),
          ),
        ),
      );

      expect(Exit.hasInterrupts(exit)).toBe(true);
      expect(logged).toEqual([]);
    }),
  );
});
