import { it } from "@effect/vitest";
import { Deferred, Effect, Layer } from "effect";
import { describe, expect } from "vitest";

import { cliRunner } from "./cli-command";
import { effectBridge } from "./effect-bridge";
import { buildRuntime } from "./effect-layer";

/** The plugin's unload, which a CLI runner hears through its signal. */
function pluginUnload(): AbortController {
  return new AbortController();
}

/** A runner over an empty runtime's bridge, and the controller standing in for unload. */
const runnerFixture = Effect.gen(function* () {
  const stack = yield* Effect.acquireDisposable(
    Effect.tryPromise(async () => new AsyncDisposableStack()),
  );
  const runtime = buildRuntime(Layer.empty, stack);
  yield* Effect.promise(() => runtime.context());
  const unload = pluginUnload();
  return {
    run: cliRunner(effectBridge(runtime), unload.signal),
    unload,
    stack,
  };
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
        Effect.tryPromise(() => run(Effect.fail(error))),
      );

      expect(rejected.cause).toBe(error);
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

      const rejected = yield* Effect.flip(Effect.tryPromise(() => pending));
      expect(rejected.cause).toBe(unload.signal.reason);
    }),
  );

  // Failure mode: a command that starts after unload rejects with the closed
  // runtime's own error instead of the reason the run stopped. The run stops
  // at its first pause, so the command pauses before its work, as a command
  // that reads Zotero does.
  it.effect("stops a command that starts after unload at its first pause", () =>
    Effect.gen(function* () {
      const { run, unload, stack } = yield* runnerFixture;
      let ran = false;

      unload.abort(new Error("Plugin unloaded"));
      yield* Effect.promise(() => stack.disposeAsync());
      const rejected = yield* Effect.flip(
        Effect.tryPromise(() =>
          run(
            Effect.yieldNow.pipe(
              Effect.andThen(
                Effect.sync(() => {
                  ran = true;
                  return "done";
                }),
              ),
            ),
          ),
        ),
      );

      expect(rejected.cause).toBe(unload.signal.reason);
      expect(ran).toBe(false);
    }),
  );
});
