// The Annotation History: one Attachment's own confirmed edits, held as the
// History Steps an undo walks back and a redo walks forward again.

import type {
  AnnotationPosition,
  ResolvedAnnotationTypeName,
} from "@zotlit/db";

import {
  resolvesSilently,
  sameStoredGeometry,
  storedPosition,
} from "./reconcile";
import { writePosition } from "./write";
import type {
  AnnotationDraft,
  GeometryEdit,
  WritablePosition,
  WriteConflict,
  WriteFailure,
} from "./write";

/** How many History Steps one Attachment's history keeps; the oldest drops first. */
export const MAX_HISTORY_STEPS = 100;

/**
 * How long after one keyboard edit the next one joins it, in milliseconds: a
 * run of nudges on one mark is one adjustment, and one press puts it back.
 */
export const JOIN_WINDOW_MS = 500;

/** Which way one press steps through the Annotation History. */
export type HistoryDirection = "undo" | "redo";

/**
 * Which edit one History Step came from. A step carries its kind, and steps of
 * different kinds never merge, so a colour pick made after a comment session is
 * a step of its own. `existence` is a create and a delete alike: undoing one
 * leaves the other, so the two are one kind read in opposite directions.
 */
export type HistoryEditKind = "color" | "comment" | "existence" | "geometry";

/**
 * Everything a restore writes back for one Annotation, which is everything a
 * create sends: Zotero keeps no record of an erased item, so a delete's step
 * carries the whole Annotation rather than a reference to it.
 */
export type HistoryContent = Omit<AnnotationDraft, "parentKey">;

/**
 * What a confirmed record holds for a create or a delete. Structural, as
 * {@link HistoryRecord} is, and wider than it because a restore writes every
 * field rather than comparing one.
 */
export interface HistoryRestorable extends HistoryRecord {
  /** Zotero's printed-page label, which a create sends back with the rest. */
  pageLabel: string | null;
}

/**
 * What a confirmed record holds for the fields a History Step compares and
 * writes back. Structural, so the step algebra names no service type.
 */
export interface HistoryRecord {
  type: ResolvedAnnotationTypeName;
  color: string | null;
  comment: string | null;
  position: AnnotationPosition;
  sortIndex: string;
  text: string | null;
}

/**
 * One Annotation's values on one side of a History Step: the fields that edit
 * changed and nothing else, so an outside edit to another field of the same
 * Annotation never blocks the undo.
 *
 * A Geometry Edit's three fields travel as one, because the Sort Index and a
 * highlight's quoted text follow the position they were computed from.
 */
export interface HistoryFields {
  color?: string;
  comment?: string;
  geometry?: GeometryEdit;
  /**
   * Whether Zotero holds the Annotation at all, and what it holds for it:
   * `null` says Zotero holds no such Annotation, which is what a create's
   * `before` and a delete's `after` carry. Absent on a step that changed a
   * field of an Annotation that stood throughout.
   */
  content?: HistoryContent | null;
}

/**
 * What made one edit, and when the user made it. Only an edit that carries this
 * joins the step before it; a pointer drag is always a step of its own.
 */
export interface HistoryJoin {
  /** The input a run of edits comes from, which only its own kind joins. */
  input: "keyboard";
  /** When the edit was made, which the join window is measured across. */
  at: Temporal.Instant;
}

/** What one History Step did to one Annotation. */
export interface HistoryChange {
  /** The Annotation's Indexed Key. */
  annotationKey: string;
  /** What the fields held before the edit, which an undo writes back. */
  before: HistoryFields;
  /** What Zotero confirmed after the edit, which an undo checks against. */
  after: HistoryFields;
}

/**
 * One user action in the Annotation History, held as the before and after
 * values of the fields it changed on each Annotation it touched.
 */
export interface HistoryStep {
  kind: HistoryEditKind;
  /** One entry per Annotation the action touched, in reading order. */
  changes: readonly HistoryChange[];
  /** What a following edit of the same kind joins this step by. */
  join?: HistoryJoin;
  /**
   * What joins the confirmed writes of one gesture into this one step, where
   * that gesture wrote more than one Annotation: an ink stroke split at the
   * position ceiling creates several Annotations and is still one stroke.
   * Absent on a step that stands alone.
   */
  group?: string;
}

/**
 * The Annotation as a restore would write it, or `null` for a record whose
 * position no create can send — everything outside a PDF, and a shape this
 * build does not know. A record the Annotation Source answered no Sort Index
 * for is `null` too: Zotero's create demands one and computes none.
 */
export function contentOf(record: HistoryRestorable): HistoryContent | null {
  const position = writablePosition(record.position);
  if (!position) return null;
  return {
    type: record.type,
    color: record.color ?? "",
    comment: record.comment ?? "",
    text: record.text ?? "",
    pageLabel: record.pageLabel ?? "",
    sortIndex: record.sortIndex,
    position,
  };
}

/**
 * Whether Zotero holds now what a create or a delete left there: the very
 * Annotation for a step that made one, and no Annotation at all for a step
 * that erased one. The colour, comment, text and position are compared the way
 * a Write Conflict compares them, so an equal value is a match.
 */
export function sameContent(
  content: HistoryContent | null,
  record: HistoryRecord | null,
): boolean {
  if (content === null || record === null)
    return content === null && record === null;
  const stored = storedPosition(record.position);
  return (
    content.type === record.type &&
    resolvesSilently("color", content.color, record.color) &&
    sameStringField(content.comment, record.comment) &&
    sameStringField(content.text, record.text) &&
    stored !== null &&
    writePosition(content.position) === stored
  );
}

/**
 * Whether a written string field is what Zotero holds. Zotero stores a cleared
 * string as no value, so the empty string a create sends and the absent value a
 * read answers are the same value.
 */
function sameStringField(written: string, held: string | null): boolean {
  return written === (held ?? "");
}

/**
 * The fields a confirmed record carries for an edit of this kind, or `null`
 * where the record holds none to put back: a record Zotero holds no colour for
 * has no colour to put back, and a position no Geometry Edit writes has none
 * either.
 */
export function historyFieldsOf(
  kind: HistoryEditKind,
  record: HistoryRecord,
): HistoryFields | null {
  switch (kind) {
    case "color":
      return record.color === null ? null : { color: record.color };
    case "existence":
      // A create and a delete each name an Annotation Zotero holds on one side
      // and none on the other, which a record on its own cannot say. Their
      // fields are built by contentOf over the whole record a restore writes
      // back, so there is nothing for one confirmed record to answer here.
      return null;
    case "comment":
      // Zotero stores a cleared comment as no comment, so the empty string is
      // what an Annotation carrying none is written back as.
      return { comment: record.comment ?? "" };
    case "geometry": {
      const position = writablePosition(record.position);
      if (!position) return null;
      const quotes = record.type === "highlight" || record.type === "underline";
      return {
        geometry: {
          position,
          sortIndex: record.sortIndex,
          ...(quotes && record.text !== null && { text: record.text }),
        },
      };
    }
  }
}

/**
 * A read position as a Geometry Edit writes it, or `null` for a position no
 * Geometry Edit ever proposes — an EPUB or snapshot selector, or one this
 * plugin could not parse.
 */
function writablePosition(
  position: AnnotationPosition,
): WritablePosition | null {
  switch (position.kind) {
    case "pdf-rects":
    case "pdf-ink":
    case "pdf-text":
      return position;
    default:
      return null;
  }
}

/**
 * Whether the record Zotero holds now still carries what a step left there.
 * An equal value is a match, as it is for a Write Conflict, so an undo whose
 * value Zotero already holds meets no false conflict.
 */
export function stillHolds(
  fields: HistoryFields,
  record: HistoryRecord,
): boolean {
  if (
    fields.color !== undefined &&
    !resolvesSilently("color", fields.color, record.color)
  ) {
    return false;
  }
  if (
    fields.comment !== undefined &&
    !resolvesSilently("comment", fields.comment, record.comment)
  ) {
    return false;
  }
  if (fields.content !== undefined && !sameContent(fields.content, record)) {
    return false;
  }
  return (
    fields.geometry === undefined || sameStoredGeometry(fields.geometry, record)
  );
}

/**
 * Whether the record a `412` answered with still carries what a step left
 * there. The refused write has already re-read the Annotation, so this is the
 * second comparison rather than a second read: a version race sends the undo's
 * write again, and a value that moved drops the step.
 */
export function stillHeldAfterConflict(
  fields: HistoryFields,
  conflict: WriteConflict,
): boolean {
  switch (conflict.write) {
    case "color":
      return (
        fields.color !== undefined &&
        resolvesSilently("color", fields.color, conflict.fresh)
      );
    case "comment":
      return (
        fields.comment !== undefined &&
        resolvesSilently("comment", fields.comment, conflict.fresh)
      );
    case "geometry":
      return (
        fields.geometry !== undefined &&
        sameStoredGeometry(fields.geometry, conflict.fresh)
      );
    default:
      return false;
  }
}

/**
 * What one press of the undo or redo key left. Every outcome that acted names
 * the Annotation the reader lands on.
 */
export type HistoryOutcome =
  /** No step stood, or a guard met the press; nothing was written. */
  | { kind: "idle" }
  /** The step was written. */
  | { kind: "stepped"; annotationKey: string }
  /**
   * The step was written and it took its Annotations off the Attachment, so
   * there is nothing left to select. The reader clears its selection and comes
   * back to the page the first of them sat on.
   */
  | { kind: "removed"; annotationKey: string; pageIndex: number }
  /**
   * Zotero holds another value for a field the step names, or no longer holds
   * the Annotation at all. Nothing was written and the step was dropped, so the
   * next press takes the step before it.
   */
  | { kind: "changed"; annotationKey: string }
  /** The write did not land. The step was dropped and the list refreshed. */
  | { kind: "failed"; failure: WriteFailure }
  /** Editing is not allowed right now, so nothing was tried. */
  | { kind: "blocked" };

/**
 * Whether a newly confirmed edit continues the run of nudges that stands on the
 * undo stack: both are Geometry Edits, the same input made them, on the one
 * same Annotation, inside the join window. A run is a Geometry Edit's own way
 * of grouping, so no other kind meets this, and steps of different kinds never
 * merge: a colour pick between two nudges ends the run.
 */
function joins(standing: HistoryStep, made: HistoryStep): boolean {
  if (made.kind !== "geometry" || standing.kind !== made.kind) return false;
  if (!standing.join || !made.join) return false;
  if (standing.join.input !== made.join.input) return false;
  const [held] = standing.changes;
  const [next] = made.changes;
  if (standing.changes.length !== 1 || made.changes.length !== 1) return false;
  if (!held || !next || held.annotationKey !== next.annotationKey) return false;
  const since = standing.join.at.until(made.join.at).total("milliseconds");
  return since >= 0 && since < JOIN_WINDOW_MS;
}

/**
 * Whether a newly confirmed edit belongs to the gesture the step on top already
 * holds: both name the one same group, and both are of the one same kind. An
 * ink stroke split at the position ceiling creates several Annotations and is
 * still one stroke, so its creates are one step. A step that names no group
 * stands alone, so no other rule's step is ever drawn into one.
 */
function joinsGroup(standing: HistoryStep, made: HistoryStep): boolean {
  return (
    standing.kind === made.kind &&
    made.group !== undefined &&
    standing.group === made.group
  );
}

/**
 * The one step a joined run leaves: the step that stood keeps its `before`, so
 * undoing ten nudges goes back to where the mark was before the first one, and
 * the new edit supplies the `after` an undo checks Zotero against.
 */
function joinedStep(standing: HistoryStep, made: HistoryStep): HistoryStep {
  const held = standing.changes[0];
  const next = made.changes[0];
  if (!held || !next) return made;
  return {
    kind: made.kind,
    changes: [
      {
        annotationKey: next.annotationKey,
        before: held.before,
        after: next.after,
      },
    ],
    // The window runs from the last edit of the run, so a run of nudges joins
    // for as long as the presses keep coming.
    ...(made.join && { join: made.join }),
  };
}

/** The stack the step a press of `direction` leaves behind belongs on. */
export function opposite(direction: HistoryDirection): HistoryDirection {
  return direction === "undo" ? "redo" : "undo";
}

/**
 * One Attachment's Annotation History. Memory only, and open only while a PDF
 * view of the Attachment holds it: it counts its holders, so two views of one
 * Attachment share one history and the last one to close ends it.
 *
 * @see apps/obsidian/docs/adr/0059-annotation-history-is-per-attachment-checked-by-field-value-and-restores-under-a-new-key.md
 */
export class AnnotationHistory {
  #holders = 1;
  readonly #stacks: Record<HistoryDirection, HistoryStep[]> = {
    undo: [],
    redo: [],
  };

  /** One more PDF view of the Attachment opened. */
  hold(): void {
    this.#holders += 1;
  }

  /**
   * One PDF view of the Attachment closed.
   *
   * @returns how many views still hold the history open.
   */
  release(): number {
    this.#holders -= 1;
    return this.#holders;
  }

  /** Whether a press of `direction` has a step to take. */
  holds(direction: HistoryDirection): boolean {
    return this.#stacks[direction].length > 0;
  }

  /**
   * Take one confirmed edit into the history, which discards what a redo would
   * have put back: history stays a single line, as it does in every editor.
   *
   * An edit that names the group the step on top names joins that step rather
   * than starting one, so one gesture that wrote several Annotations is one
   * step and its undo takes them all or none. An edit that continues the run
   * of nudges the top step holds joins it too, so a run of keyboard nudges on
   * one mark costs one press to put back. Both rules ask the step on top for
   * its kind first, so steps of different kinds never merge.
   *
   * @returns whether the edit joined the step that stood.
   */
  record(step: HistoryStep): boolean {
    this.#stacks.redo.length = 0;
    const standing = this.peek("undo");
    const stack = this.#stacks.undo;
    if (standing && joinsGroup(standing, step)) {
      stack[stack.length - 1] = {
        ...standing,
        changes: [...standing.changes, ...step.changes],
      };
      return true;
    }
    if (standing && joins(standing, step)) {
      stack[stack.length - 1] = joinedStep(standing, step);
      return true;
    }
    this.push("undo", step);
    return false;
  }

  /**
   * Answer for `to` wherever a step names `from`, in both stacks. Zotero gives
   * a restored Annotation a new key, and the steps recorded against the old one
   * describe the Annotation the researcher sees, so they follow it.
   */
  rename(from: string, to: string): void {
    for (const stack of [this.#stacks.undo, this.#stacks.redo]) {
      for (const [index, step] of stack.entries()) {
        if (!step.changes.some(({ annotationKey }) => annotationKey === from))
          continue;
        stack[index] = {
          ...step,
          changes: step.changes.map((change) =>
            change.annotationKey === from
              ? { ...change, annotationKey: to }
              : change,
          ),
        };
      }
    }
  }

  /** The step a press of `direction` would take, left where it is. */
  peek(direction: HistoryDirection): HistoryStep | null {
    return this.#stacks[direction].at(-1) ?? null;
  }

  /**
   * Take one step off a stack, whether it was written or dropped. The step is
   * named rather than taken off the top, so an edit recorded while it ran —
   * a comment autosave that came due — is left where it stands.
   */
  drop(direction: HistoryDirection, step: HistoryStep): void {
    const stack = this.#stacks[direction];
    const at = stack.lastIndexOf(step);
    if (at >= 0) stack.splice(at, 1);
  }

  /**
   * Move a step on the stack an undo takes from to `next`, or take it out
   * again where `next` is `null`: one comment editing session shapes a single
   * step over every save it makes, and a session that settles on the text it
   * began with leaves none. A step that stack no longer holds is left alone.
   */
  reshape(step: HistoryStep, next: HistoryStep | null): void {
    const stack = this.#stacks.undo;
    const at = stack.indexOf(step);
    if (at < 0) return;
    stack.splice(at, 1, ...(next ? [next] : []));
    // Moving a step is a newly confirmed edit like any other, so what a redo
    // would have put back goes: history stays a single line.
    this.#stacks.redo.length = 0;
  }

  /** Put the step a taken one left behind on the stack that steps it back. */
  push(direction: HistoryDirection, step: HistoryStep): void {
    const stack = this.#stacks[direction];
    stack.push(step);
    if (stack.length > MAX_HISTORY_STEPS) stack.shift();
  }
}
