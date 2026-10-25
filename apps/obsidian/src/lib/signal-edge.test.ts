// The edge where a plain caller's AbortSignal ends an Effect run.
import { it } from "@effect/vitest";
import { Cause, Effect, Exit } from "effect";
import { describe, expect } from "vitest";

import { settleAtEdge } from "./signal-edge";

describe("settleAtEdge", () => {
  it("returns the value of a success", () => {
    expect(settleAtEdge(Exit.succeed(1), AbortSignal.abort())).toBe(1);
  });

  it.effect("throws the signal's reason where the signal ended the run", () =>
    Effect.promise(async () => {
      const controller = new AbortController();
      const reason = new Error("Cancelled");
      const pending = Effect.runPromiseExit(Effect.never, {
        signal: controller.signal,
      });
      controller.abort(reason);
      const exit = await pending;
      let thrown: unknown;
      try {
        settleAtEdge(exit, controller.signal, () => 0);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBe(reason);
    }),
  );

  it("answers `released` where another interrupt ended the run", () => {
    const exit = Exit.failCause(Cause.interrupt());
    expect(settleAtEdge(exit, new AbortController().signal, () => 0)).toBe(0);
  });

  it("throws the squashed interrupt without a `released` answer", () => {
    const exit = Exit.failCause(Cause.interrupt());
    expect(() => settleAtEdge(exit, undefined)).toThrow();
  });

  it("throws a failure even after the signal aborted", () => {
    const error = new Error("failed");
    expect(() =>
      settleAtEdge(Exit.fail(error), AbortSignal.abort(), () => 0),
    ).toThrow(error);
  });
});
