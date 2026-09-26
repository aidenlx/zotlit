// What a card shows when Zotero's copy moved under a write, decided as data
// rather than in a
// component, so a test reads the verbs instead of clicking them.
//
// @see apps/obsidian/policies/ui-seams.md
// @see https://github.com/aidenlx/zotlit/issues/1151
import { annotationColorLabel } from "@/lib/annotation-colors";
import * as m from "@/lib/i18n/generated/messages";
import type {
  TextField,
  WriteConflict,
} from "@/services/annotation-repository/service";
import { isTextField } from "@/services/annotation-repository/write";

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
  /**
   * The question a delete asks instead of showing two values, or what a
   * Geometry Edit's conflict is about, since a position has no value in words.
   */
  prompt: string | null;
  actions: readonly ConflictAction[];
}

/**
 * The two verbs of a text field's Write Conflict, named for the field: the
 * user's text, or the text Zotero holds.
 */
const TEXT_FIELD_VERBS: Record<
  TextField,
  () => { applyAgain: string; discard: string }
> = {
  comment: () => ({
    applyAgain: m.annot_view_conflict_use_comment(),
    discard: m.annot_view_conflict_keep_zotero_comment(),
  }),
  text: () => ({
    applyAgain: m.annot_view_conflict_use_text(),
    discard: m.annot_view_conflict_keep_zotero_text(),
  }),
};

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
  const verbs = isTextField(conflict.write)
    ? TEXT_FIELD_VERBS[conflict.write]()
    : null;
  const discard: ConflictAction = {
    kind: "discard",
    label: verbs?.discard ?? m.annot_view_conflict_discard(),
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
  if (conflict.write === "geometry") {
    // A position has no value in words, so the prompt names what moved. A
    // highlight's or underline's quoted text does, and stands beside it.
    const { attempted, fresh } = conflict;
    return {
      title: m.annot_view_conflict_title(),
      values:
        attempted.text === undefined
          ? []
          : [
              {
                label: m.annot_view_conflict_fresh(),
                value: fresh.text || m.annot_view_conflict_no_value(),
              },
              {
                label: m.annot_view_conflict_attempted(),
                value: attempted.text,
              },
            ],
      prompt: m.annot_view_conflict_geometry_prompt(),
      actions: [
        { kind: "apply-again", label: m.annot_view_conflict_apply_again() },
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
      {
        kind: "apply-again",
        label: verbs?.applyAgain ?? m.annot_view_conflict_apply_again(),
      },
      discard,
    ],
  };
}
