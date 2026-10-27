// The capability notices for callers outside Effect: the reader's gestures,
// the Query View, the setting tab and the debug surface.
import type { EffectBridge } from "@/lib/effect-bridge";

import type { CapabilityNotices } from "./notices";

/** The capability notices' gestures, one bridge call each. */
export interface CapabilityNoticesHandle {
  /**
   * Allow editing.
   *
   * @returns when Zotero has answered and its notice, if any, is on screen.
   */
  allowEditing(): Promise<void>;
  /**
   * Re-check Zotero, then open the "Zotero editing" settings row.
   *
   * @returns when the row is open, so a caller need not count microtasks to
   *   know the gesture is done.
   */
  showEditingCapability(): Promise<void>;
  /** An edit gesture met a block on this Attachment. */
  reportBlockedGesture(attachmentKey: string): void;
}

export function bindCapabilityNotices(
  bridge: Pick<EffectBridge, "runPromise" | "runSync">,
  notices: CapabilityNotices["Service"],
): CapabilityNoticesHandle {
  return {
    allowEditing: () => bridge.runPromise(notices.allowEditing),
    showEditingCapability: () =>
      bridge.runPromise(notices.showEditingCapability),
    reportBlockedGesture: (attachmentKey) =>
      bridge.runSync(notices.reportBlockedGesture(attachmentKey)),
  };
}
