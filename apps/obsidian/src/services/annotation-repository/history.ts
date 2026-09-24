// The Annotation History: one Attachment's own confirmed edits, held as the
// History Steps an undo walks back and a redo walks forward again.

import { resolvesSilently } from "./reconcile";
import type { WriteConflict, WriteFailure } from "./write";

/** How many History Steps one Attachment's history keeps; the oldest drops first. */
export const MAX_HISTORY_STEPS = 100;

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
  color: string | null;
}

/**
 * One Annotation's values on one side of a History Step: the fields that edit
 * changed and nothing else, so an outside edit to another field of the same
 * Annotation never blocks the undo.
 */
export interface HistoryFields {
  color?: string;
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
}

/**
 * The fields a confirmed record carries for an edit of this kind, or `null`
 * where an edit of that kind records no step: a comment session and a run of
 * keyboard nudges are each one step, which their own grouping rules decide, and
 * a record Zotero holds no colour for has no colour to put back.
 */
export function historyFieldsOf(
  kind: HistoryEditKind,
  record: HistoryRecord,
): HistoryFields | null {
  if (kind !== "color" || record.color === null) return null;
  return { color: record.color };
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
  return (
    fields.color === undefined ||
    resolvesSilently("color", fields.color, record.color)
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
  if (conflict.write !== "color") return false;
  return stillHolds(fields, { color: conflict.fresh });
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
   */
  record(step: HistoryStep): void {
    this.#stacks.redo.length = 0;
    this.push("undo", step);
  }

  /** The step a press of `direction` would take, left where it is. */
  peek(direction: HistoryDirection): HistoryStep | null {
    return this.#stacks[direction].at(-1) ?? null;
  }

  /** Take the top step off one stack, whether it was written or dropped. */
  drop(direction: HistoryDirection): void {
    this.#stacks[direction].pop();
  }

  /** Put the step a taken one left behind on the stack that steps it back. */
  push(direction: HistoryDirection, step: HistoryStep): void {
    const stack = this.#stacks[direction];
    stack.push(step);
    if (stack.length > MAX_HISTORY_STEPS) stack.shift();
  }
}
