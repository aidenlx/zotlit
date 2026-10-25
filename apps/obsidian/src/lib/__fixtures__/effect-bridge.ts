// A test-owned Effect bridge over an empty managed runtime.
// oxlint-disable-next-line no-restricted-imports -- The fixture needs an empty standalone runtime with no plugin services.
import { Layer, ManagedRuntime } from "@/lib/effect";
import { effectBridge } from "@/lib/effect-bridge";
import type { EffectBridge } from "@/lib/effect-bridge";

export function openTestBridge(): EffectBridge & AsyncDisposable {
  const runtime = ManagedRuntime.make(Layer.empty);
  return Object.assign(effectBridge(runtime), {
    [Symbol.asyncDispose]: () => runtime.dispose(),
  });
}
