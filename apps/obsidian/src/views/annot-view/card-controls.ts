// What an Annotation Card's header controls may do, decided as data rather
// than in a component: one rule read by the colour dot, the comment toggle and
// the delete verb, keyed by the Editing Capability and by what a write left.
//
// @see apps/obsidian/policies/ui-seams.md
// @see https://github.com/aidenlx/zotlit/issues/1145
import type { IconName } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import type { EditingCapability } from "@/services/annotation-repository/capability";
import { editingCapabilityCopy } from "@/services/annotation-repository/capability-copy";
import type { CommentDraft } from "@/services/annotation-repository/service";
import { writeFailureMessage } from "@/services/annotation-repository/write";
import type { MutationState } from "@/services/annotation-repository/write";

/**
 * Why a verb cannot act while the Editing Capability stands in its way, and the
 * one gesture that could change that — what the capability drawer states.
 */
export interface CardBlock {
  /** The capability's own sentence: its detail, or its label where it has none. */
  reason: string;
  /** The gesture the drawer offers, or `null` where nothing the user does helps. */
  action: "allow-editing" | null;
}

/** One header control: whether it runs, and what its tooltip says. */
export interface CardControl {
  /**
   * Whether the press is refused outright, which only a write in flight is:
   * there is nothing to say about it beyond the tooltip, and it ends by itself.
   */
  disabled: boolean;
  /**
   * The capability standing in the way, or `null` while the verb acts. A
   * blocked verb stays pressable and only rests dimmed: its press opens the
   * drawer, which states {@link CardBlock.reason} from the capability in force,
   * so the explanation is reached by a gesture rather than only by a hover.
   */
  blocked: CardBlock | null;
  /** `aria-label`, which Obsidian renders as the hover tooltip. */
  tooltip: string;
}

/** What the card's editing controls read. */
export interface CardControlsInput {
  /** The Editing Capability of the Attachment this card belongs to. */
  capability: EditingCapability;
  /** What the last write left on this Annotation. */
  mutation: MutationState;
  /** Whether the Annotation already carries a comment. */
  hasComment: boolean;
  /** The instant a cooldown's remaining seconds are measured from. */
  now: Temporal.Instant;
}

/**
 * The three verbs an Annotation Card offers. Copying and revealing are absent
 * because they never change Zotero and so never stand down.
 */
export interface CardControls {
  color: CardControl;
  comment: CardControl;
  delete: CardControl;
}

/**
 * Editing tools are available only after explicit authorization.
 */
export function editingLive(capability: EditingCapability): boolean {
  return capability.kind === "writable";
}

/**
 * Every editing control of one card, with the reason for each that cannot run.
 *
 * The two reasons a verb cannot act are not the same thing. A write in flight
 * disables all three and says so: pending shows as disabled verbs and nothing
 * else, because no provisional value is ever drawn, and it ends without the
 * user doing anything. A capability that refuses writes is a state the user can
 * read about and sometimes end, so the verb stays pressable and its press
 * carries {@link CardControl.blocked} to the drawer.
 *
 * A write that failed, conflicted, or lost its answer leaves the verbs to the
 * capability, so the user can try again.
 */
export function cardControls({
  capability,
  mutation,
  hasComment,
  now,
}: CardControlsInput): CardControls {
  const pending = mutation.kind === "pending";
  const blocked = pending ? null : capabilityBlock(capability, now);
  const control = (label: string): CardControl => {
    if (pending)
      return {
        disabled: true,
        blocked: null,
        tooltip: m.annot_view_card_saving(),
      };
    if (blocked === null)
      return { disabled: false, blocked: null, tooltip: label };
    // The verb keeps its own name: the drawer states the reason on a press.
    return { disabled: false, blocked, tooltip: label };
  };
  return {
    color: control(m.annot_view_card_color()),
    comment: control(commentLabel(hasComment)),
    delete: control(m.annot_view_menu_delete()),
  };
}

/** "Add comment" for a card with none, "Edit comment" for one that has one. */
export function commentLabel(hasComment: boolean): string {
  return hasComment
    ? m.annot_view_card_edit_comment()
    : m.annot_view_card_add_comment();
}

/** The comment toggle's icon, which says the same thing its label does. */
export function commentIcon(hasComment: boolean): IconName {
  return hasComment ? "message-square" : "message-square-plus";
}

/**
 * Why the editing verbs cannot run, or `null` while they can. A write in
 * flight outranks the capability: it is the nearer answer to "why can I not
 * press this".
 *
 * The Mark Popup's row reads the same rule, because its colour, comment and
 * delete are the same three writes reached from the PDF reader
 * (aidenlx/zotlit#1148).
 */
export function editingBlockedReason(
  capability: EditingCapability,
  mutation: MutationState,
  now: Temporal.Instant,
): string | null {
  if (mutation.kind === "pending") return m.annot_view_card_saving();
  return capabilityBlock(capability, now)?.reason ?? null;
}

/**
 * What one Editing Capability leaves a verb to say, or `null` while the verb
 * acts. Authorization is the one state a gesture ends, so it is the one that
 * carries an action; every other state is waited out or fixed in Zotero.
 */
export function capabilityBlock(
  capability: EditingCapability,
  now: Temporal.Instant,
): CardBlock | null {
  if (editingLive(capability)) return null;
  const copy = editingCapabilityCopy(capability, now);
  return {
    reason: copy.detail ?? copy.label,
    action:
      capability.kind === "authorization-required" ? "allow-editing" : null,
  };
}

/** Shared comment feedback for the Annotation View and PDF reader. */
export function commentEditorControls(
  capability: EditingCapability,
  draft: CommentDraft | null,
  now: Temporal.Instant,
) {
  const available = editingLive(capability);
  const pending = draft?.state.kind === "pending";
  const oneTime = capability.kind === "writable" && capability.oneTime;
  const manual = !!oneTime || !!draft?.manualSave;
  let hint = m.annot_view_comment_auto();
  if (pending) hint = m.annot_view_card_saving();
  else if (draft?.state.kind === "failed") {
    const { failure } = draft.state;
    hint =
      failure.kind === "unauthorized"
        ? m.annot_view_comment_unauthorized()
        : failure.kind === "unknown-outcome" || failure.kind === "unreachable"
          ? m.annot_view_comment_unconfirmed()
          : writeFailureMessage(failure, now);
  } else if (!available) hint = m.annot_view_comment_paused();
  else if (oneTime) hint = m.annot_view_comment_one_time();
  else if (manual) hint = m.annot_view_comment_resume();
  return {
    readOnly: !available,
    saveDisabled: !available || pending,
    manual,
    hint,
  };
}
