// What each Editing Capability says to the user, in one table every surface
// reads: the settings row, the reader's Creation Toolbar, and the Annotation
// View toolbar all name one state the same way.

import * as m from "@/lib/i18n/generated/messages";

import type { EditingCapability } from "./capability";

/**
 * How a surface should present the state, so a renderer picks its colour and
 * its accessible role without re-deriving them from the enum.
 */
export type CapabilityTone =
  /** Editing is on; nothing is wrong and nothing is pending. */
  | "ready"
  /** The user can fix it, and the gesture that does is the obvious one. */
  | "action"
  /** ZotLit or Zotero is working, or waiting; nothing to do but wait. */
  | "busy"
  /** Editing is off for a reason the user should read. */
  | "warning";

/** One Editing Capability as a surface renders it. */
export interface CapabilityCopy {
  /** The Obsidian icon the always-present affordance shows. */
  icon: string;
  tone: CapabilityTone;
  /** One line naming the state. */
  label: string;
  /** What to do about it, or null where the label is the whole of it. */
  detail: string | null;
  /**
   * Whether the icon turns, because ZotLit or Zotero is working. Decided here
   * rather than re-derived from the enum, so the table stays the one dispatch.
   */
  spinning: boolean;
}

/**
 * The copy and icon for one Editing Capability.
 *
 * A cooldown counts down, so the caller supplies the instant it is read at and
 * re-reads this while the clock runs; every other state is a pure lookup.
 *
 * @param capability the state to render.
 * @param now the instant a cooldown's remaining seconds are measured from.
 * @see https://github.com/aidenlx/zotlit/issues/1139 — "Editing Capability and degraded states"
 */
export function editingCapabilityCopy(
  capability: EditingCapability,
  now: Temporal.Instant,
): CapabilityCopy {
  switch (capability.kind) {
    case "writable":
      return {
        icon: "pencil",
        tone: "ready",
        label: m.capability_writable(),
        detail: null,
        spinning: false,
      };
    case "authorization-required":
      // The same icon as writable: the control stays live, and the gesture is
      // what opens Zotero's dialog.
      return {
        icon: "pencil",
        tone: "action",
        label: m.capability_authorization_required(),
        detail: m.capability_authorization_required_detail(),
        spinning: false,
      };
    case "authorizing":
      return {
        icon: "loader",
        tone: "busy",
        label: m.capability_authorizing(),
        detail: m.capability_authorizing_detail(),
        spinning: true,
      };
    case "cooldown":
      return {
        icon: "clock",
        tone: "busy",
        label: m.capability_cooldown(),
        detail: m.capability_cooldown_detail({
          seconds: secondsUntil(capability.retryAfter, now),
        }),
        spinning: false,
      };
    case "read-only":
      return readOnlyCopy(capability.reason);
  }
}

/**
 * The always-present affordance, as both of its renderers draw it: the reader's
 * vanilla render function and the Annotation View's Preact component read this
 * one answer, so the two surfaces cannot drift apart.
 *
 * @see apps/obsidian/docs/adr/0042-the-surfaces-inside-the-pdf-reader-are-vanilla-dom-on-obsidians-popover.md
 */
export interface CapabilityAffordance {
  /** The Obsidian icon, from the one icon map. */
  icon: string;
  tone: CapabilityTone;
  /** The accessible name, which Obsidian also renders as the hover tooltip. */
  tooltip: string;
  /** Whether the icon turns, because ZotLit or Zotero is working. */
  spinning: boolean;
  /** Whole seconds left of a cooldown, or null while nothing counts down. */
  countdown: number | null;
}

/**
 * What the affordance shows for one Editing Capability.
 *
 * The tooltip carries the whole of the copy table's answer, because the
 * affordance is one icon with nowhere else to put the detail; a surface that
 * counts down re-reads this once a second while {@link
 * CapabilityAffordance.countdown} is not null.
 *
 * @param capability the state to show.
 * @param now the instant a cooldown's remaining seconds are measured from.
 */
export function editingCapabilityAffordance(
  capability: EditingCapability,
  now: Temporal.Instant,
): CapabilityAffordance {
  const { icon, tone, label, detail, spinning } = editingCapabilityCopy(
    capability,
    now,
  );
  return {
    icon,
    tone,
    tooltip:
      detail === null
        ? label
        : m.capability_affordance_tooltip({ label, detail }),
    spinning,
    countdown:
      capability.kind === "cooldown"
        ? secondsUntil(capability.retryAfter, now)
        : null,
  };
}

/**
 * Whole seconds left of a cooldown, never negative: a deadline already past
 * reads as zero rather than counting up.
 */
export function secondsUntil(
  deadline: Temporal.Instant,
  now: Temporal.Instant,
): number {
  const left = now.until(deadline).total("seconds");
  return left <= 0 ? 0 : Math.ceil(left);
}

function readOnlyCopy(
  reason: Extract<EditingCapability, { kind: "read-only" }>["reason"],
): CapabilityCopy {
  switch (reason) {
    case "probing":
      // Checking is not a fault, so it reads as busy rather than as a warning.
      return {
        icon: "loader",
        tone: "busy",
        label: m.capability_probing(),
        detail: null,
        spinning: true,
      };
    case "zotero-unavailable":
      return warning(
        m.capability_zotero_unavailable(),
        m.capability_zotero_unavailable_detail(),
      );
    case "local-api-disabled":
      return warning(
        m.capability_local_api_disabled(),
        m.capability_local_api_disabled_detail(),
      );
    case "incompatible-zotero":
      return warning(
        m.capability_incompatible_zotero(),
        m.capability_incompatible_zotero_detail(),
      );
    case "invalid-response":
      return warning(
        m.capability_invalid_response(),
        m.capability_invalid_response_detail(),
      );
    case "server-changed":
      return warning(
        m.capability_server_changed(),
        m.capability_server_changed_detail(),
      );
    case "library-read-only":
      return warning(
        m.capability_library_read_only(),
        m.capability_library_read_only_detail(),
      );
  }
}

function warning(label: string, detail: string): CapabilityCopy {
  return {
    icon: "alert-triangle",
    tone: "warning",
    label,
    detail,
    spinning: false,
  };
}
