// The Local Bridge for callers outside Effect: the saved Notice.
import type { EffectBridge } from "@/lib/effect-bridge";

import type { LocalBridge } from "./service";

/** The edge handle `build.ts` binds; see {@link bindLocalBridge}. */
export interface LocalBridgeHandle {
  /**
   * Follow each connected Save that wrote a Profile's document in this vault
   * until the returned function stops it, or the runtime closes.
   */
  onProfileSaved(callback: (profileId: string) => void): () => void;
}

/** The Local Bridge over `bridge`. */
export function bindLocalBridge(
  bridge: Pick<EffectBridge, "subscribe">,
  service: LocalBridge["Service"],
): LocalBridgeHandle {
  return {
    onProfileSaved: (callback) => bridge.subscribe(service.saved, callback),
  };
}
