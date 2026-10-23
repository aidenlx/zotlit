import { expect, vi } from "vitest";

import { Context, Effect, Layer, Logger, Queue } from "@/lib/effect";
import { it } from "@/lib/effect-vitest";

import { Service, ServiceInitError } from "./service-base";
import { serviceLayer } from "./service-layer";

/** A service whose startup settles with `load`, then holds one resource. */
class Probe extends Service {
  readonly released = vi.fn();
  ready: Promise<void>;

  constructor(load: Promise<void>) {
    super();
    this.ready = this.#load(load);
  }

  async #load(load: Promise<void>): Promise<void> {
    await load;
    await using stack = new AsyncDisposableStack();
    stack.defer(this.released);
    this.commit(stack.move());
  }
}

class ProbeTag extends Context.Service<ProbeTag, Probe>()(
  "zotlit/service-layer/Probe",
) {}

/** The bridged Probe, open for the current Scope; its logs go to `logged`. */
const probeOf = (load: Promise<void>, logged?: Queue.Queue<string>) =>
  Effect.map(
    Layer.build(
      serviceLayer(ProbeTag, {
        key: "probe",
        make: Effect.sync(() => new Probe(load)),
      }).pipe(
        Layer.provide(
          Logger.layer(
            logged
              ? [
                  Logger.make(({ message }) => {
                    Queue.offerUnsafe(logged, String(message));
                  }),
                ]
              : [],
          ),
        ),
      ),
    ),
    Context.get(ProbeTag),
  );

// Failure modes: the build waits on a startup that has not settled, or
// closing the scope leaves the service's resources acquired.
it.effect(
  "builds before startup settles and disposes the service with its scope",
  () =>
    Effect.gen(function* () {
      const { promise, resolve } = Promise.withResolvers<void>();
      const probe = yield* Effect.scoped(
        Effect.gen(function* () {
          const probe = yield* probeOf(promise);
          expect(probe.released).not.toHaveBeenCalled();
          resolve();
          yield* Effect.promise(() => probe.ready);
          return probe;
        }),
      );

      expect(probe.released).toHaveBeenCalledOnce();
    }),
);

// Failure modes: a startup failure fails the layer build, reaches dependents
// unwrapped, or goes unreported.
it.effect("wraps and logs a startup failure without failing the build", () =>
  Effect.gen(function* () {
    const cause = new Error("boom");
    const logged = yield* Queue.unbounded<string>();
    const probe = yield* probeOf(Promise.reject(cause), logged);

    const error = yield* Effect.promise(() =>
      probe.ready.catch((e: unknown) => e),
    );
    expect(error).toBeInstanceOf(ServiceInitError);
    expect((error as ServiceInitError).cause).toBe(cause);
    expect(yield* Queue.take(logged)).toBe(
      "Service {key} failed to initialize",
    );
  }),
);

// Failure mode: a service that throws while disposing rejects the plugin's
// teardown, so the services closing after it never close.
it.effect("logs a failed disposal and still closes the scope", () =>
  Effect.gen(function* () {
    const logged = yield* Queue.unbounded<string>();
    yield* Effect.scoped(
      Effect.gen(function* () {
        const probe = yield* probeOf(Promise.resolve(), logged);
        yield* Effect.promise(() => probe.ready);
        probe.released.mockImplementation(() => {
          throw new Error("stuck");
        });
      }),
    );

    expect(yield* Queue.take(logged)).toBe("Service {key} failed to dispose");
  }),
);
