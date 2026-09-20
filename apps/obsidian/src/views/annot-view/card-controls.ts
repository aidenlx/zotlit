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

/** One header control: whether it runs, and what its tooltip says. */
export interface CardControl {
  disabled: boolean;
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
 * A write in flight disables all three and says so: pending shows as disabled
 * verbs and nothing else, because no provisional value is ever drawn. A write
 * that failed, conflicted, or lost its answer leaves the verbs to the
 * capability, so the user can try again.
 */
export function cardControls({
  capability,
  mutation,
  hasComment,
  now,
}: CardControlsInput): CardControls {
  const blocked = editingBlockedReason(capability, mutation, now);
  const control = (label: string): CardControl =>
    blocked === null
      ? { disabled: false, tooltip: label }
      : { disabled: true, tooltip: blocked };
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
  if (editingLive(capability)) return null;
  const copy = editingCapabilityCopy(capability, now);
  return copy.detail ?? copy.label;
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
