// Names the plugin-graph Layer whose acquisition died, so plugin load fails loud.
import { Cause, Effect, Layer } from "effect";

/**
 * A defect during one service's acquisition. Plugin load stops on it:
 * `buildRuntime` admits no typed failure, so only a bug reaches here.
 */
export class ServiceStartupFailed extends Error {
  override readonly name = "ServiceStartupFailed";

  constructor(
    readonly service: string,
    override readonly cause: Cause.Cause<unknown>,
  ) {
    super(`${service} failed to start`);
  }
}

/**
 * Tag `layer`'s acquisition defect with `service`. An interrupt passes through
 * as unload, and a failure an inner layer already named keeps its name.
 */
export function startingAs(service: string) {
  return <A, R>(layer: Layer.Layer<A, never, R>): Layer.Layer<A, never, R> =>
    layer.pipe(
      Layer.catchCause((cause) =>
        Layer.effectContext<A, never, never>(
          Cause.hasInterruptsOnly(cause) ||
            Cause.squash(cause) instanceof ServiceStartupFailed
            ? Effect.failCause(cause as Cause.Cause<never>)
            : Effect.die(new ServiceStartupFailed(service, cause)),
        ),
      ),
    );
}
