// The Editing Capability affordance in the Annotation View's toolbar: the
// Preact half of "one copy table and icon map, two renderers" (ADR 0042). The
// reader draws the same answer with a vanilla render function.
import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

import { Icon } from "@/components/obsidian/icon";
import { activatable, cn, tooltipAttrs } from "@/lib/utils";
import type { EditingCapability } from "@/services/annotation-repository/capability";
import { editingCapabilityAffordance } from "@/services/annotation-repository/capability-copy";
import type { AnnotationRepository } from "@/services/annotation-repository/service";

import { useAnnotStore } from "./store";

/** How often the affordance is redrawn while Zotero's rate limit runs. */
const COUNTDOWN_INTERVAL = Temporal.Duration.from({ seconds: 1 });

/** What the affordance reads its state through, and hears its changes on. */
export type CapabilityReads = Pick<
  AnnotationRepository,
  "capability" | "capabilityFor" | "on"
>;

export interface CapabilityAffordanceProps {
  capabilities: CapabilityReads;
  /** The click: a Capability Probe, then the "Zotero editing" settings row. */
  onActivate: () => void;
}

/**
 * Always present, whatever the state: a plain icon while editing is on, the
 * same icon with what to do about it while authorization is needed, a spinner
 * while Zotero is being asked, a clock counting the rate limit down, and a
 * warning with the reason while editing is off.
 *
 * @see https://github.com/aidenlx/zotlit/issues/1147
 */
export function CapabilityAffordance({
  capabilities,
  onActivate,
}: CapabilityAffordanceProps) {
  const ref = useRef<HTMLDivElement>(null);
  const attachmentKey = useAnnotStore((s) => s.selectedAttachmentKey);
  const capability = useEditingCapability(capabilities, attachmentKey);
  const now = useCountdown(capability.kind === "cooldown", ref);
  const { icon, tone, tooltip, spinning, countdown } =
    editingCapabilityAffordance(capability, now);

  return (
    <div
      ref={ref}
      data-zt-capability-tone={tone}
      aria-busy={spinning || undefined}
      {...activatable(onActivate)}
      className={cn(
        "clickable-icon",
        "zt:flex zt:items-center zt:gap-1",
        tone === "warning" && "mod-warning",
      )}
      {...tooltipAttrs(tooltip)}
    >
      <Icon name={icon} className={spinning ? "zt:animate-spin" : undefined} />
      {countdown !== null && (
        <span className="zt:text-xs zt:tabular-nums">{countdown}</span>
      )}
    </div>
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
    const id = win.setInterval(
      () => setNow(Temporal.Now.instant()),
      COUNTDOWN_INTERVAL.total("milliseconds"),
    );
    return () => win.clearInterval(id);
  }, [active, node]);
  return now;
}
