// Run an Effect Layer from code that lives outside Effect: the plugin's
// startup, a test harness.
import * as Cause from "effect/Cause";
import * as NativeEffect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";

import { withLogCategory } from "./effect-log";
import { runtimeServices } from "./effect-services";

/**
 * A runtime over `layer` and the runtime services (browser scheduling and
 * logging, both References, so absent from its type); disposing `stack`
 * disposes it. The runtime's scope is on the stack before the build runs, so
 * a build that fails releases what it acquired when the stack unwinds.
 *
 * Acquisition starts on the first run. Await `runtime.context()` before
 * synchronous reads when a layer can acquire resources asynchronously.
 */
export function buildRuntime<R>(
  layer: Layer.Layer<R>,
  stack: AsyncDisposableStack,
): ManagedRuntime.ManagedRuntime<R, never> {
  const runtime = ManagedRuntime.make(
    Layer.provideMerge(layer, Layer.succeedContext(runtimeServices)),
  );
  stack.defer(() =>
    NativeEffect.runPromiseWith(runtimeServices)(
      runtime.disposeEffect.pipe(
        NativeEffect.catchCause((cause) =>
          NativeEffect.logError("Could not close the services").pipe(
            NativeEffect.annotateLogs({ error: Cause.squash(cause) }),
          ),
        ),
        withLogCategory("services"),
      ),
    ),
  );
  return runtime;
}
