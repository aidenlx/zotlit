// What an Annotation Card's editing controls may do, decided as data rather
// than in a component: one rule read by the colour dot, the comment field,
// "Edit quoted text", the tag toggle and the delete verb, keyed by the
// Editing Capability and by what a write left.
//
// @see apps/obsidian/policies/ui-seams.md
// @see https://github.com/aidenlx/zotlit/issues/1145

import type { ResolvedAnnotationTypeName } from "@zotlit/db";

import * as m from "@/lib/i18n/generated/messages";
import type { EditingCapability } from "@/services/annotation-repository/capability";
import { editingCapabilityCopy } from "@/services/annotation-repository/capability-copy";
import type {
  AnnotationRecord,
  TagDraft,
  TextField,
  TextFieldDraft,
} from "@/services/annotation-repository/service";
import {
  isTextField,
  noTagChange,
  tagChange,
  writeFailureMessage,
} from "@/services/annotation-repository/write";
import type {
  ConflictedWrite,
  MutationState,
  WriteFailure,
} from "@/services/annotation-repository/write";

import type { FieldEditorWording } from "./field-editor";

/**
 * Why a verb cannot act while the Editing Capability stands in its way, and the
 * one gesture that could change that — what the capability notice states.
 */
export interface CardBlock {
  /** The capability's own sentence: its detail, or its label where it has none. */
  reason: string;
  /** The gesture the notice offers, or `null` where nothing the user does helps. */
  action: "allow-editing" | null;
}

/** One editing control: whether it runs, and what its tooltip says. */
export interface CardControl {
  /**
   * Whether the press is refused outright, which only a write in flight is:
   * there is nothing to say about it beyond the tooltip, and it ends by itself.
   */
  disabled: boolean;
  /**
   * The capability standing in the way, or `null` while the verb acts. A
   * blocked verb stays pressable and only rests dimmed: its press raises a
   * notice, which states {@link CardBlock.reason} from the capability in force,
   * so the explanation is reached by a gesture rather than only by a hover.
   */
  blocked: CardBlock | null;
  /** `aria-label`, which Obsidian renders as the hover tooltip. */
  tooltip: string;
}

/** What the card's editing controls read. */
export interface CardControlsInput {
  /** What stands in the way of each verb; see {@link annotationBlocks}. */
  blocks: VerbBlocks;
  /** What the last write left on this Annotation. */
  mutation: MutationState;
  /** Whether the Annotation already carries a tag. */
  hasTags: boolean;
  /** The Annotation's type, which decides whether it has a Quoted Text. */
  type: ResolvedAnnotationTypeName;
}

/**
 * The verbs an Annotation Card offers. Copying and revealing are absent
 * because they never change Zotero and so never stand down.
 */
export interface CardControls {
  color: CardControl;
  /**
   * The comment field. A card offers it only while selected alone (ADR
   * 0066); the Mark Popup always does.
   */
  comment: CardControl;
  /** The tag toggle, which follows the comment field's rules. */
  tags: CardControl;
  /**
   * "Edit quoted text", which opens the editor on the Quoted Text; `null`
   * where the Annotation has none to edit. Only a highlight or underline has
   * a Quoted Text, and a card offers it only while selected alone (ADR 0066).
   */
  text: CardControl | null;
  delete: CardControl;
}

/** One editing verb of an Annotation Card. */
export type CardVerb = keyof CardControls;

/**
 * What stands in the way of each editing verb, or `null` where the verb acts.
 * Each verb has its own gate, so one verb can act while another is refused.
 */
export type VerbBlocks = Readonly<Record<CardVerb, CardBlock | null>>;

/**
 * Each verb's block under one Editing Capability. The capability is the
 * Attachment's, so it gives every verb the same block.
 */
export function capabilityBlocks(
  capability: EditingCapability,
  now: Temporal.Instant,
): VerbBlocks {
  const block = capabilityBlock(capability, now);
  return {
    color: block,
    comment: block,
    tags: block,
    text: block,
    delete: block,
  };
}

/**
 * Each verb's block on one Annotation: the one seam every surface reads its
 * verbs' blocks from, the card, the view's menus and the Mark Popup alike.
 * The Editing Capability's block comes first.
 */
export function annotationBlocks({
  capability,
  now,
}: {
  annotation: AnnotationRecord;
  capability: EditingCapability;
  now: Temporal.Instant;
}): VerbBlocks {
  return capabilityBlocks(capability, now);
}

/**
 * The block of the verb a Write Conflict stands on. A Geometry Edit changes
 * the mark itself, so it has the colour's gate.
 */
export function conflictBlock(
  blocks: VerbBlocks,
  write: ConflictedWrite,
): CardBlock | null {
  return blocks[write === "geometry" ? "color" : write];
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
 * disables all of them and says so, and it ends without the user doing
 * anything; what it proposes the card already draws as its Pending Proposal. A capability that refuses writes is a state the user can
 * read about and sometimes end, so the verb stays pressable and its press
 * carries {@link CardControl.blocked} to the notice.
 *
 * A write that failed, conflicted, or lost its answer leaves the verbs to the
 * capability, so the user can try again.
 */
export function cardControls({
  blocks,
  mutation,
  hasTags,
  type,
}: CardControlsInput): CardControls {
  const pending = gestureInFlight(mutation);
  const control = (verb: CardVerb, label: string): CardControl => {
    if (pending)
      return {
        disabled: true,
        blocked: null,
        tooltip: m.annot_view_card_saving(),
      };
    const blocked = blocks[verb];
    if (blocked === null)
      return { disabled: false, blocked: null, tooltip: label };
    // The verb keeps its own name: the notice states the reason on a press.
    return { disabled: false, blocked, tooltip: label };
  };
  return {
    color: control("color", m.annot_view_card_color()),
    comment: control("comment", m.annot_view_card_comment_label()),
    tags: control(
      "tags",
      hasTags ? m.annot_view_card_edit_tags() : m.annot_view_card_add_tags(),
    ),
    delete: control("delete", m.annot_view_menu_delete()),
    text: hasQuotedText(type)
      ? control("text", m.annot_view_menu_edit_text())
      : null,
  };
}

/**
 * A press on an editing control that opens an editor: refused while a write
 * is in flight, spent on the notice that states the block while the Editing
 * Capability stands in the way, and otherwise the control's own `act`.
 */
export function pressControl(
  control: CardControl,
  {
    act,
    onBlocked,
  }: { act: () => void; onBlocked: (block: CardBlock) => void },
): void {
  if (control.disabled) return;
  if (control.blocked) onBlocked(control.blocked);
  else act();
}

/** Whether Zotero stores a Quoted Text for this type of Annotation. */
export function hasQuotedText(type: ResolvedAnnotationTypeName): boolean {
  return type === "highlight" || type === "underline";
}

/**
 * One verb over a group of cards, from each card's own control: refused while
 * a write is in flight on any of them, and blocked while any card's control is
 * blocked, with the block of the first such card.
 */
export function groupControl(
  controls: readonly CardControl[],
): Pick<CardControl, "disabled" | "blocked"> {
  const disabled = controls.some((control) => control.disabled);
  return {
    disabled,
    blocked: disabled
      ? null
      : (controls.find((control) => control.blocked)?.blocked ?? null),
  };
}

/**
 * Why the editing verbs cannot run, or `null` while they can. A write in
 * flight outranks the capability: it is the nearer answer to "why can I not
 * press this".
 *
 * The creation popup and the Creation Toolbar read the same rule. The Mark
 * Popup's selected row reads it through {@link cardControls}, because its
 * colour, tags, delete and comment field are the card's writes reached from
 * the PDF reader (aidenlx/zotlit#1148).
 */
export function editingBlockedReason(
  capability: EditingCapability,
  mutation: MutationState,
  now: Temporal.Instant,
): string | null {
  if (gestureInFlight(mutation)) return m.annot_view_card_saving();
  return capabilityBlock(capability, now)?.reason ?? null;
}

/**
 * Whether a write in flight stands the verbs down. A comment or Quoted Text
 * write does not: its text is already drawn by the editor, and a verb pressed meanwhile queues
 * behind it, so disabling the row would only flicker it on every autosave. A
 * tag editing session's own save does not either: the tag editor shows it as
 * saving. A tag undo or redo is a gesture's write, and does.
 */
function gestureInFlight(mutation: MutationState): boolean {
  return (
    mutation.kind === "pending" &&
    !isTextField(mutation.write) &&
    !mutation.session
  );
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

/**
 * The status line under a text field's editor, and whether the editor takes a
 * write: one rule for every text field's draft, on the Annotation View and in
 * the PDF reader alike. Its lines name no field.
 */
export function fieldEditorControls(
  block: CardBlock | null,
  draft: TextFieldDraft | null,
  now: Temporal.Instant,
) {
  const available = block === null;
  const manual = !!draft?.manualSave;
  // Automatic saving states nothing, in flight or at rest: the quiet case is
  // the normal one, and a line that comes and goes under the editor with every
  // pause in typing only competes with the text. Only a save the user pressed
  // for is waited on, so only that one says so.
  const pending = manual && draft?.state.kind === "pending";
  let hint: string | null = null;
  if (pending) hint = m.annot_view_card_saving();
  else if (draft?.state.kind === "failed")
    hint = failedSaveReason(block, draft.state.failure, now);
  // The block's own sentence, which names the state and the gesture that
  // ends it. A line of its own here could only restate it more vaguely.
  else if (block) hint = block.reason;
  // A draft waiting on a manual save says so with its Save button.
  // A sentence restating the button is one line the card does not need.
  return {
    readOnly: !available,
    saveDisabled: !available || pending,
    manual,
    hint,
  };
}

/**
 * Why a draft's save failed, in the words a comment and tags share: the
 * reason line a held draft carries.
 */
function failedSaveReason(
  block: CardBlock | null,
  failure: WriteFailure,
  now: Temporal.Instant,
): string {
  // A refused write and a refused editor are one state, so they say one
  // thing: the block's own sentence, as the blocked case says it.
  if (failure.kind === "unauthorized")
    return block?.reason ?? writeFailureMessage(failure, now);
  if (failure.kind === "unknown-outcome" || failure.kind === "unreachable")
    return m.annot_view_comment_unconfirmed();
  return writeFailureMessage(failure, now);
}

/**
 * The line under the tag editor, and whether the editor takes changes: the
 * comment editor's rules, for a draft that saves when the editor closes. A
 * save in flight says so in the field itself.
 *
 * @see apps/obsidian/docs/adr/0063-annotation-tags-save-once-per-editing-session-and-merge-by-name.md
 */
export function tagEditorControls(
  block: CardBlock | null,
  draft: TagDraft | null,
  now: Temporal.Instant,
): { readOnly: boolean; hint: string | null } {
  let hint: string | null = null;
  if (draft?.state.kind === "failed")
    hint = failedSaveReason(block, draft.state.failure, now);
  else if (block) hint = block.reason;
  return { readOnly: block !== null, hint };
}

/**
 * The tag names every surface draws for one Annotation: a draft's own while it
 * is edited, held, or failed, so the card and the Mark Popup show the same
 * unsaved change. A saving draft's names are the record's Pending Proposal, so
 * the record is drawn from the moment the save is asked for.
 *
 * @see apps/obsidian/docs/adr/0064-surfaces-draw-pending-proposals-from-query-core-mutation-variables.md
 */
export function shownTagNames(
  record: Pick<AnnotationRecord, "tags">,
  draft: TagDraft | null,
): readonly string[] {
  return draft && draft.state.kind !== "pending" ? draft.names : record.tags;
}

/**
 * The comment text both comment editors open on and submit; see
 * {@link shownText}.
 */
export function shownComment(
  record: Pick<AnnotationRecord, "comment">,
  draft: TextFieldDraft | null,
): string {
  return shownText(record.comment, draft);
}

/**
 * The text a field editor opens on and submits, for any text field: the
 * draft's own text while a draft stands, a save in flight included, since
 * text typed behind that save is newer than what the save carries. The
 * rendered value under a closed editor draws the record instead, which holds
 * the save's Pending Proposal.
 *
 * @param confirmed the field's value on the record.
 */
export function shownText(
  confirmed: string | null,
  draft: TextFieldDraft | null,
): string {
  return draft ? draft.text : (confirmed ?? "");
}

/** One verb the held-draft panel offers. */
export interface HeldDraftAction {
  kind: "save" | "allow-editing" | "discard";
  label: string;
  /** Whether the press acts. A verb the capability refuses rests disabled. */
  enabled: boolean;
  /**
   * Whether the verb carries the accent. The panel's own surface is the fill
   * Obsidian gives a resting button, so a row of resting buttons on it reads
   * as a row of text: the way out wears the accent to be a button at all.
   * Discarding never takes it — it ends the text the user wrote.
   */
  primary: boolean;
}

/**
 * Text the user holds that Zotero does not have, with the verbs that end it.
 *
 * The panel is the card's answer to "what do I do with this": every state it
 * announces carries a way out, so a held draft is never a label the user can
 * only read. A draft the plugin resolves by itself announces nothing — the
 * quiet case is the normal one.
 */
export interface HeldDraft {
  /** The panel's title, which names the field the text is for. */
  title: string;
  /** The user's text, which the panel shows in place of Zotero's value. */
  text: string;
  /** Why the text is still held, or `null` where the state speaks for itself. */
  reason: string | null;
  actions: readonly HeldDraftAction[];
}

/**
 * What each text field's controls say: its editor's placeholder and name, its
 * Save button, and its held draft's title. One entry per text field.
 */
export interface TextFieldWording extends FieldEditorWording {
  /** The Save button of the editor and of the held draft. */
  save: string;
  /** The held draft's title, which names the field the text is for. */
  draft: string;
}

const TEXT_FIELD_WORDING: Record<TextField, () => TextFieldWording> = {
  comment: () => ({
    placeholder: m.annot_view_card_comment_placeholder(),
    label: m.annot_view_card_comment_label(),
    save: m.annot_view_comment_save(),
    draft: m.annot_view_comment_draft(),
  }),
  text: () => ({
    placeholder: m.annot_view_card_text_placeholder(),
    label: m.annot_view_card_text_label(),
    save: m.annot_view_text_save(),
    draft: m.annot_view_text_draft(),
  }),
};

/** What one text field's controls say, in the active language. */
export function textFieldWording(field: TextField): TextFieldWording {
  return TEXT_FIELD_WORDING[field]();
}

/**
 * What a surface announces about one text field's held draft, or `null`
 * where it announces nothing.
 *
 * Three states stay quiet, because none of them asks the user for anything.
 * A draft matching Zotero holds nothing. A write in flight settles by itself,
 * and the card already draws its text as the write's Pending Proposal. A conflict has its own panel with its own two
 * verbs (aidenlx/zotlit#1151).
 *
 * @see apps/obsidian/policies/ui-seams.md
 */
export function heldTextDraft(
  field: TextField,
  draft: TextFieldDraft | null,
  { block, now }: { block: CardBlock | null; now: Temporal.Instant },
): HeldDraft | null {
  if (!draft) return null;
  if (draft.state.kind === "pending" || draft.state.kind === "conflict")
    return null;
  if (draft.text === draft.baseline) return null;
  const { hint, manual, saveDisabled } = fieldEditorControls(block, draft, now);
  // An automatic save is already on its way, so the card waits for it rather
  // than asking the user to do what the plugin is about to do.
  if (!manual && !saveDisabled) return null;
  const { draft: title, save } = textFieldWording(field);
  return {
    title,
    text: draft.text,
    reason: block?.reason ?? hint,
    actions: heldDraftActions(block, { save, saveDisabled }),
  };
}

/** Tags the user holds that Zotero does not have, with the verbs that end them. */
export interface HeldTags {
  /** The draft's names, which the panel shows in place of Zotero's tags. */
  names: readonly string[];
  /** Why the tags are still held. */
  reason: string | null;
  actions: readonly HeldDraftAction[];
}

/**
 * What the card and the Mark Popup announce about one held tag draft, or
 * `null` where they announce nothing: the comment's rule, for a draft whose
 * editor has closed. A session still open on either surface, a save in
 * flight, and a session that changed nothing ask the user for nothing, so
 * Save tags never cuts a session short.
 *
 * @see apps/obsidian/docs/adr/0063-annotation-tags-save-once-per-editing-session-and-merge-by-name.md
 */
export function heldTagDraft(
  block: CardBlock | null,
  draft: TagDraft | null,
  now: Temporal.Instant,
): HeldTags | null {
  if (!draft?.held || draft.state.kind === "pending") return null;
  if (noTagChange(tagChange(draft.baseline, draft.names))) return null;
  return {
    names: draft.names,
    reason:
      block?.reason ??
      (draft.state.kind === "failed"
        ? failedSaveReason(block, draft.state.failure, now)
        : null),
    actions: heldDraftActions(block, {
      save: m.annot_view_tags_save(),
      saveDisabled: block !== null,
    }),
  };
}

/**
 * Whether two held tag panels show the same thing: the names, the reason, and
 * each verb as drawn. A surface that draws the panel again for an equal value
 * would drop a click between its press and its release.
 */
export function sameHeldTags(a: HeldTags, b: HeldTags): boolean {
  return (
    a.reason === b.reason &&
    a.names.length === b.names.length &&
    a.names.every((name, i) => name === b.names[i]) &&
    sameHeldActions(a.actions, b.actions)
  );
}

/** {@link sameHeldTags}, for a held text panel: a comment or a Quoted Text. */
export function sameHeldDraft(a: HeldDraft, b: HeldDraft): boolean {
  return (
    a.title === b.title &&
    a.text === b.text &&
    a.reason === b.reason &&
    sameHeldActions(a.actions, b.actions)
  );
}

function sameHeldActions(
  a: readonly HeldDraftAction[],
  b: readonly HeldDraftAction[],
): boolean {
  return (
    a.length === b.length &&
    a.every((action, i) => {
      const other = b[i]!;
      return (
        action.kind === other.kind &&
        action.label === other.label &&
        action.enabled === other.enabled &&
        action.primary === other.primary
      );
    })
  );
}

/**
 * The held-draft panel's verbs. Save wears the accent while it can act; where
 * it cannot, the grant that ends the refusal does.
 */
function heldDraftActions(
  block: CardBlock | null,
  { save, saveDisabled }: { save: string; saveDisabled: boolean },
): HeldDraftAction[] {
  const actions: HeldDraftAction[] = [
    {
      kind: "save",
      label: save,
      enabled: !saveDisabled,
      primary: !saveDisabled,
    },
  ];
  if (block?.action === "allow-editing") {
    actions.push({
      kind: "allow-editing",
      label: m.capability_enable_editing(),
      enabled: true,
      // Where the draft cannot be saved, the grant is the way out.
      primary: saveDisabled,
    });
  }
  actions.push({
    kind: "discard",
    label: m.annot_view_comment_discard(),
    enabled: true,
    primary: false,
  });
  return actions;
}
