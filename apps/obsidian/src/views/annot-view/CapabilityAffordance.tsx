// The Editing Capability affordance in the Annotation View's toolbar: the
// Preact half of "one copy table and icon map, two renderers" (ADR 0042). The
// reader draws the same answer with a vanilla render function.
import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

import { Icon } from "@/components/obsidian/icon";
import { cn, tooltipAttrs } from "@/lib/utils";
import type { EditingCapability } from "@/services/annotation-repository/capability";
import { editingCapabilityAffordance } from "@/services/annotation-repository/capability-copy";
import { countdownInterval } from "@/services/annotation-repository/cooldown";
import type { AnnotationRepository } from "@/services/annotation-repository/service";

import { useAnnotStore } from "./store";

/** What the affordance reads its state through, and hears its changes on. */
export type CapabilityReads = Pick<
  AnnotationRepository,
  "capability" | "capabilityFor" | "on"
>;

export interface CapabilityAffordanceProps {
  capabilities: CapabilityReads;
  /** Requests write authorization through Zotero’s native approval dialog. */
  onActivate: () => void;
}

/**
 * Offers authorization when Zotero is reachable, and shows a disabled status
 * while approval is pending. Reading and authorized editing stay quiet.
 *
 * @see https://github.com/aidenlx/zotlit/issues/1147
 */
export function CapabilityAffordance({
  capabilities,
  onActivate,
}: CapabilityAffordanceProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const attachmentKey = useAnnotStore((s) => s.selectedAttachmentKey);
  const capability = useEditingCapability(capabilities, attachmentKey);
  const now = useCountdown(capability.kind === "cooldown", ref);
  const affordance = editingCapabilityAffordance(capability, now);
  if (affordance === null) return null;
  const { icon, tone, tooltip, label, spinning, countdown } = affordance;

  return (
    <button
      type="button"
      ref={ref}
      data-zt-capability-tone={tone}
      aria-busy={spinning || undefined}
      disabled={affordance.disabled}
      onClick={onActivate}
      className={cn(
        "clickable-icon",
        "zt:flex zt:min-w-0 zt:items-center zt:gap-1 zt:text-start zt:whitespace-normal",
        tone === "warning" && "mod-warning",
      )}
      {...tooltipAttrs(tooltip)}
    >
      <Icon name={icon} className={spinning ? "zt:animate-spin" : undefined} />
      <span>{label}</span>
      {countdown !== null && (
        <span className="zt:text-xs zt:tabular-nums">{countdown}</span>
      )}
    </button>
  );
}

/**
 * The Attachment on screen's Editing Capability, or the session's while no
 * Attachment is chosen.
 *
 * Held in state rather than selected on each render: every read builds a fresh
 * object, which a snapshot compared by identity would never settle on.
 *
 * @see https://github.com/aidenlx/zotlit/issues/1146 — the same hazard, in the store
 */
function useEditingCapability(
  capabilities: CapabilityReads,
  attachmentKey: string | null,
): EditingCapability {
  const read = useCallback(
    (): EditingCapability =>
      attachmentKey === null
        ? capabilities.capability
        : capabilities.capabilityFor(attachmentKey),
    [capabilities, attachmentKey],
  );
  const [capability, setCapability] = useState(read);
  useEffect(() => {
    setCapability(read());
    return capabilities.on("capability-changed", () => setCapability(read()));
  }, [capabilities, read]);
  return capability;
}

/**
 * A clock that ticks once a second while a cooldown is counting down, on the
 * window this affordance is mounted in — the Annotation View pops out, and a
 * timer belongs to the window that armed it.
 *
 * @see apps/obsidian/policies/popout-windows.md
 */
function useCountdown(
  active: boolean,
  node: RefObject<HTMLElement | null>,
): Temporal.Instant {
  const [now, setNow] = useState(() => Temporal.Now.instant());
  useEffect(() => {
    const win = node.current?.win;
    if (!active || !win) return;
    setNow(Temporal.Now.instant());
    return countdownInterval(win, () => setNow(Temporal.Now.instant()));
  }, [active, node]);
  return now;
}
