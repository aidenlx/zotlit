// What a card shows when Zotero's copy moved under a write, and what a create
// whose answer was lost shows in its place — decided as data rather than in a
// component, so a test reads the verbs instead of clicking them.
//
// @see apps/obsidian/policies/ui-seams.md
// @see https://github.com/aidenlx/zotlit/issues/1151
import { annotationColorLabel } from "@/lib/annotation-colors";
import * as m from "@/lib/i18n/generated/messages";
import type {
  MutationState,
  WriteConflict,
} from "@/services/annotation-repository/service";
import { writeFailureReason } from "@/services/annotation-repository/write";

/** One value of a Write Conflict, under the label that says whose it is. */
export interface ConflictValue {
  label: string;
  /** The value in the user's own words — a colour's name, a comment's text. */
  value: string;
}

/** What one card offers to resolve a Write Conflict with. */
export type ConflictVerb = "apply-again" | "delete-anyway" | "discard";

export interface ConflictAction {
  kind: ConflictVerb;
  label: string;
}

/** The panel a conflicted card shows, in the order it is read. */
export interface ConflictPanel {
  title: string;
  /**
   * Zotero's value beside the user's input, in that order: what Zotero holds
   * is what the user is choosing against. `null` for a delete, which asks for
   * no value and so has none to compare.
   */
  values: readonly ConflictValue[];
  /** The question a delete asks instead of showing two values. */
  prompt: string | null;
  actions: readonly ConflictAction[];
}

/**
 * One Write Conflict as the card puts it: the fresh Zotero value beside the
 * user's input, and the two verbs that end it. Neither edit is lost silently —
 * "Apply again" sends the user's value against the copy Zotero holds now, and
 * "Discard" keeps Zotero's.
 *
 * A delete shows the fresh card itself rather than two values, and asks
 * "Delete anyway" once against what the user can now see.
 *
 * @see https://github.com/aidenlx/zotlit/issues/1139 — "Editing Capability and degraded states"
 */
export function conflictPanel(conflict: WriteConflict): ConflictPanel {
  const discard: ConflictAction = {
    kind: "discard",
    label: m.annot_view_conflict_discard(),
  };
  if (conflict.write === "delete") {
    return {
      title: m.annot_view_conflict_title(),
      values: [],
      prompt: m.annot_view_conflict_delete_prompt(),
      actions: [
        {
          kind: "delete-anyway",
          label: m.annot_view_conflict_delete_anyway(),
        },
        discard,
      ],
    };
  }
  const show = (value: string | null): string =>
    value === null || value === ""
      ? m.annot_view_conflict_no_value()
      : conflict.write === "color"
        ? annotationColorLabel(value.toLowerCase())
        : value;
  return {
    title: m.annot_view_conflict_title(),
    values: [
      { label: m.annot_view_conflict_fresh(), value: show(conflict.fresh) },
      {
        label: m.annot_view_conflict_attempted(),
        value: show(conflict.attempted),
      },
    ],
    prompt: null,
    actions: [
      { kind: "apply-again", label: m.annot_view_conflict_apply_again() },
      discard,
    ],
  };
}

/** What one badged card offers to resolve an Uncertain Create with. */
export interface UncertainAction {
  kind: "retry" | "discard";
  label: string;
  /** True while the retry is in flight: pending shows as disabled verbs. */
  disabled: boolean;
}

/** The badged card one Uncertain Create stands as. */
export interface UncertainCard {
  title: string;
  /** Why the card is badged, or what the last retry answered. */
  detail: string;
  actions: readonly UncertainAction[];
}

/**
 * One Uncertain Create as its badged card puts it. Nothing retries on its own,
 * so both verbs are the user's: "Try again" re-sends the original request on
 * its original write token, and "Discard" drops the card.
 *
 * @param state what the create's last request left.
 * @param now the instant a cooldown's remaining seconds are measured from.
 * @see apps/obsidian/docs/adr/0039-an-uncertain-create-is-reconciled-by-stable-fields-and-retried-only-by-the-user.md
 */
export function uncertainCard(
  state: MutationState,
  now: Temporal.Instant,
): UncertainCard {
  const sending = state.kind === "pending";
  return {
    title: m.annot_view_uncertain_title(),
    detail:
      state.kind === "failed"
        ? writeFailureReason(state.failure, now)
        : sending
          ? m.annot_view_uncertain_sending()
          : m.annot_view_uncertain_detail(),
    actions: [
      {
        kind: "retry",
        label: m.annot_view_uncertain_retry(),
        disabled: sending,
      },
      {
        kind: "discard",
        label: m.annot_view_uncertain_discard(),
        disabled: sending,
      },
    ],
  };
}
