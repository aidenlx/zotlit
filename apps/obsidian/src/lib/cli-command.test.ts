import { describe, expect } from "vitest";

import { Deferred, Effect, Layer } from "@/lib/effect";
import { acquireAsyncDisposable } from "@/lib/effect-scope";
import { it } from "@/lib/effect-vitest";

import { cliRunner } from "./cli-command";
import { buildRuntime } from "./effect-layer";

/** A runner over an empty runtime, and the controller standing in for unload. */
const runnerFixture = Effect.gen(function* () {
  const stack = yield* acquireAsyncDisposable(
    async () => new AsyncDisposableStack(),
  );
  const runtime = buildRuntime(Layer.empty, stack);
  const unload = new AbortController();
  return { run: cliRunner(runtime, unload.signal), unload };
});

describe("cliRunner", () => {
  it.effect("resolves with the text a command prints", () =>
    Effect.gen(function* () {
      const { run } = yield* runnerFixture;

      expect(yield* Effect.promise(() => run(Effect.succeed("done")))).toBe(
        "done",
      );
    }),
  );

  it.effect("rejects with the error a command fails with", () =>
    Effect.gen(function* () {
      const { run } = yield* runnerFixture;
      const error = new TypeError("bad parameter");

      const rejected = yield* Effect.flip(
        Effect.tryPromise({
          try: () => run(Effect.fail(error)),
          catch: (cause) => cause,
        }),
      );

      expect(rejected).toBe(error);
    }),
  );

  // Failure mode: unloading the plugin mid-command leaves the caller with an
  // interruption cause instead of the reason the run stopped.
  it.effect("rejects with the unload reason when unload interrupts a run", () =>
    Effect.gen(function* () {
      const { run, unload } = yield* runnerFixture;
      const started = yield* Deferred.make<void>();

      const pending = run(
        Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
      );
      yield* Deferred.await(started);
      unload.abort(new Error("Plugin unloaded"));

      const rejected = yield* Effect.flip(
        Effect.tryPromise({ try: () => pending, catch: (cause) => cause }),
      );
      expect(rejected).toBe(unload.signal.reason);
    }),
  );
});
