// A Managed Binary service with runners captured at build, for callers outside Effect.
import type { Effect } from "@/lib/effect";
import type { EffectBridge } from "@/lib/effect-bridge";

import type { ManagedBinaryApi } from "./service";

/** The service and the two ways to enter Effect with it through {@link EffectBridge}. */
export interface ManagedBinaryHandle<
  Engine extends Disposable | AsyncDisposable = Disposable | AsyncDisposable,
> {
  readonly binary: ManagedBinaryApi<Engine>;
  readonly runSync: <A>(effect: Effect.Effect<A>) => A;
  readonly runPromise: <A, E>(effect: Effect.Effect<A, E>) => Promise<A>;
}

export function bindManagedBinary<Engine extends Disposable | AsyncDisposable>(
  bridge: Pick<EffectBridge, "runSync" | "runPromise">,
  binary: ManagedBinaryApi<Engine>,
): ManagedBinaryHandle<Engine> {
  return {
    binary,
    runSync: bridge.runSync,
    runPromise: bridge.runPromise,
  };
}
