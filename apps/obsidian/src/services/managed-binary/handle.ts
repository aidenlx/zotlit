// A Managed Binary service with runners captured at build, for callers outside Effect.
import { Effect } from "@/lib/effect";
import type { ManagedRuntime } from "@/lib/effect";

import type { ManagedBinaryApi } from "./service";

/**
 * The service and the two ways to enter Effect with it. Callers run through
 * these runners and never through `runtime.runSync` / `runtime.runPromise`: a
 * disposed runtime clears its context, and the captured one still answers with
 * the service's released values.
 */
export interface ManagedBinaryHandle<
  Engine extends Disposable | AsyncDisposable = Disposable | AsyncDisposable,
> {
  readonly binary: ManagedBinaryApi<Engine>;
  readonly runSync: <A>(effect: Effect.Effect<A>) => A;
  readonly runPromise: <A, E>(effect: Effect.Effect<A, E>) => Promise<A>;
}

export function bindManagedBinary<
  R,
  Engine extends Disposable | AsyncDisposable,
>(
  runtime: ManagedRuntime.ManagedRuntime<R, never>,
  binary: ManagedBinaryApi<Engine>,
): ManagedBinaryHandle<Engine> {
  const context = runtime.runSync(Effect.context<R>());
  return {
    binary,
    runSync: Effect.runSyncWith(context),
    runPromise: Effect.runPromiseWith(context),
  };
}
