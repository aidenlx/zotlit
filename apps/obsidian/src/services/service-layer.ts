// The bridge that puts a legacy Service into the plugin's Effect Layer graph.
import { Cause, Effect, Layer } from "@/lib/effect";
import type { Context } from "@/lib/effect";
import { withLogCategory } from "@/lib/effect-log";

import { superviseReady } from "./service-base";
import type { Service } from "./service-base";

/**
 * Provide a legacy {@link Service} through Effect under `tag`: the layer
 * constructs it with `make`, and closing the layer's scope disposes it.
 *
 * The layer does not wait for `ready`, so a slow or failed startup leaves the
 * rest of the graph building, as it does under `ServiceContainer`. A startup
 * failure is wrapped in `ServiceInitError` under `key` and logged, and
 * dependents that await `ready` observe it. Disposal awaits `ready` first,
 * through the base class; a failed disposal is logged.
 */
export function serviceLayer<I, S extends Service<any>, R>(
  tag: Context.Key<I, S>,
  { key, make }: { key: string; make: Effect.Effect<S, never, R> },
): Layer.Layer<I, never, R> {
  return Layer.effect(
    tag,
    Effect.gen(function* () {
      const run = Effect.runForkWith(yield* Effect.context<never>());
      return yield* Effect.acquireRelease(
        Effect.tap(make, (service) =>
          Effect.sync(() =>
            superviseReady(key, service, (_key, error) =>
              run(
                Effect.logError("Service {key} failed to initialize").pipe(
                  Effect.annotateLogs({ key, error }),
                ),
              ),
            ),
          ),
        ),
        (service) =>
          Effect.tryPromise(() => service[Symbol.asyncDispose]()).pipe(
            Effect.catchCause((cause) =>
              Effect.logError("Service {key} failed to dispose").pipe(
                Effect.annotateLogs({ key, error: Cause.squash(cause) }),
              ),
            ),
          ),
      );
    }).pipe(withLogCategory("services")),
  );
}
