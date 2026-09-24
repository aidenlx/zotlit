// The Annotation History: one Attachment's own confirmed edits, held as the
// History Steps an undo walks back and a redo walks forward again.

import type {
  AnnotationPosition,
  ResolvedAnnotationTypeName,
} from "@zotlit/db";

import { resolvesSilently, sameStoredGeometry } from "./reconcile";
import type {
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
 * a step of its own.
 */
export type HistoryEditKind = "color" | "comment" | "geometry";

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
 * Whether a newly confirmed edit continues the step that stands on the undo
 * stack: the same input made both, on the one same Annotation, inside the join
 * window. Steps of different kinds never meet this, so a colour pick between
 * two nudges ends the run.
 */
function joins(standing: HistoryStep, made: HistoryStep): boolean {
  if (standing.kind !== made.kind) return false;
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
   * An edit that continues the run the top step holds joins it instead, so a
   * run of keyboard nudges on one mark costs one press to put back.
   *
   * @returns whether the edit joined the step that stood.
   */
  record(step: HistoryStep): boolean {
    this.#stacks.redo.length = 0;
    const standing = this.peek("undo");
    if (!standing || !joins(standing, step)) {
      this.push("undo", step);
      return false;
    }
    const stack = this.#stacks.undo;
    stack[stack.length - 1] = joinedStep(standing, step);
    return true;
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
  }

  /** Put the step a taken one left behind on the stack that steps it back. */
  push(direction: HistoryDirection, step: HistoryStep): void {
    const stack = this.#stacks[direction];
    stack.push(step);
    if (stack.length > MAX_HISTORY_STEPS) stack.shift();
  }
}
