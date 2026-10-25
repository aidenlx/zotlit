// What the "Zotero editing" row shows for one Editing Capability, decided
// before any element is touched.
import type { ButtonComponent } from "obsidian";

import type { EditingCapability } from "@/services/annotation-repository/capability";
import { editingCapabilityCopy } from "@/services/annotation-repository/capability-copy";
import type { CapabilityCopy } from "@/services/annotation-repository/capability-copy";

/** Whether one action is offered at all, and whether it can be selected now. */
export interface ActionState {
  shown: boolean;
  disabled: boolean;
}

/** Everything the row renders, decided before any element is touched. */
export interface EditingRowModel {
  status: CapabilityCopy;
  /** "Allow editing" — the gesture that asks Zotero for write permission. */
  enable: ActionState;
  check: ActionState;
  /** "Forget authorization" — offered only while there is one to forget. */
  forget: ActionState;
  /** Whether the row must redraw itself on a clock rather than on an event. */
  countsDown: boolean;
}

export interface EditingRowInput {
  capability: EditingCapability;
  /** A connection check started from this settings row is in flight. */
  checking?: boolean;
  /** Whether a Remembered Write Authorization is stored on this device. */
  remembered: boolean;
  /** The instant a cooldown's remaining seconds are measured from. */
  now: Temporal.Instant;
}

/**
 * What the "Zotero editing" row offers for one Editing Capability.
 *
 * Authorization and connection checks are separate user actions.
 */
export function editingRowModel({
  capability,
  checking = false,
  remembered,
  now,
}: EditingRowInput): EditingRowModel {
  return {
    status: editingCapabilityCopy(
      checking ? { kind: "read-only", reason: "probing" } : capability,
      now,
    ),
    enable: {
      shown: !checking && capability.kind === "authorization-required",
      disabled: checking || capability.kind !== "authorization-required",
    },
    check: {
      shown: checking || capability.kind === "read-only",
      disabled:
        checking ||
        (capability.kind === "read-only" && capability.reason === "probing"),
    },
    forget: {
      shown: remembered,
      disabled: checking || capability.kind === "authorizing",
    },
    countsDown: capability.kind === "cooldown",
  };
}

export function applyAction(
  button: ButtonComponent | undefined,
  state: ActionState,
): void {
  if (!button) return;
  button.buttonEl.toggle(state.shown);
  button.setDisabled(state.disabled);
}
