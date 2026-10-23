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
 * logging, both References, so absent from its type), built now and
 * synchronously; disposing `stack` disposes it. The runtime's scope is on the
 * stack before the build runs, so a build that throws releases what it had
 * already acquired when the stack unwinds.
 *
 * A layer that suspends throws here: plugin load does not wait. Acquire
 * synchronously, and fork async startup onto the layer's Scope.
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
  runtime.runSync(NativeEffect.void);
  return runtime;
}
