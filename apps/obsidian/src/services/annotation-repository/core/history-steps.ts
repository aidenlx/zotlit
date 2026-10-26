// Annotation History steps: opening and closing a history, and taking an undo or a redo.
import { Effect } from "effect";

import {
  AnnotationHistory,
  contentOf,
  historyFieldsOf,
  isRestore,
  opposite,
  sameContent,
  stillHeldAfterConflict,
  stillHolds,
} from "@/services/annotation-repository/history";
import type {
  FieldHistoryStep,
  HistoryChange,
  HistoryDirection,
  HistoryFields,
  HistoryOutcome,
  HistoryStep,
  TagHistoryStep,
} from "@/services/annotation-repository/history";
import {
  annotationTags,
  IDLE,
  mergeTags,
  noTagChange,
  tagChange,
  tagsPatch,
  TEXT_FIELDS,
} from "@/services/annotation-repository/write";
import type {
  AnnotationTag,
  MutationState,
  TagChange,
} from "@/services/annotation-repository/write";

import { autosaveDue, draftFor } from "./draft-store";
import { holding } from "./lists";
import { DRAFT_FIELDS, proposedTags } from "./model";
import type { AnnotationRecord } from "./model";
import type { CoreState } from "./state";
import {
  command,
  createAnnotation,
  deleteAnnotation,
  discardConflict,
  firstHeldLockRefusal,
  patchColor,
  patchGeometry,
  writeBlocked,
  writeText,
} from "./writes";
import type { WriteReadError, WriteRunFailed } from "./writes";

/** Why a History Step answered no outcome: one of its writes failed. */
type StepError = WriteRunFailed | WriteReadError;

/**
 * Open this Attachment's Annotation History, from one PDF view bound to it.
 * Every surface that writes through this repository records into the history
 * the Attachment already holds, so a second view of the same Attachment joins
 * this one rather than starting its own.
 *
 * @param attachmentKey the Attachment's Indexed Key.
 */
const openHistory = Effect.fnUntraced(function* (
  core: CoreState,
  attachmentKey: string,
) {
  const standing = core.histories.get(attachmentKey);
  if (standing) {
    standing.hold();
    return;
  }
  core.histories.set(attachmentKey, new AnnotationHistory());
  yield* Effect.logDebug("An annotation history opened").pipe(
    Effect.annotateLogs({ attachmentKey }),
  );
  core.publish({ _tag: "history-changed", attachmentKey });
});

/**
 * Give up one PDF view's hold on this Attachment's Annotation History. The
 * last view to close ends the history, so an old session can never revert
 * today's work.
 *
 * @param attachmentKey the Attachment's Indexed Key.
 */
const closeHistory = Effect.fnUntraced(function* (
  core: CoreState,
  attachmentKey: string,
) {
  const standing = core.histories.get(attachmentKey);
  if (!standing || standing.release() > 0) return;
  core.histories.delete(attachmentKey);
  yield* Effect.logDebug("An annotation history closed").pipe(
    Effect.annotateLogs({ attachmentKey }),
  );
  core.publish({ _tag: "history-changed", attachmentKey });
});

/**
 * Whether this Attachment's Annotation History holds a step to undo, and
 * nothing standing turns that press away. The momentary guards — a write in
 * flight, an undo already running — are not read here, so a verb drawn from
 * this does not flicker under its own write. An open Annotation Draft on the
 * step's own Annotation is read, because it stands for as long as the
 * comment editor is open: a menu row drawn enabled under one would do
 * nothing, and say nothing.
 *
 * @param attachmentKey the Attachment's Indexed Key.
 */
function canUndo(
  core: CoreState,
  attachmentKey: string,
): Effect.Effect<boolean> {
  return stepStands(core, attachmentKey, "undo");
}

/** Whether this Attachment's Annotation History holds a step to redo. */
function canRedo(
  core: CoreState,
  attachmentKey: string,
): Effect.Effect<boolean> {
  return stepStands(core, attachmentKey, "redo");
}

/**
 * Step one confirmed edit back: the platform undo key, and the palette's
 * "Undo annotation change".
 *
 * @param attachmentKey the Attachment's Indexed Key.
 */
function undo(
  core: CoreState,
  attachmentKey: string,
): Effect.Effect<HistoryOutcome, StepError> {
  return stepHistory(core, attachmentKey, "undo");
}

/** Step one undone edit forward again. */
function redo(
  core: CoreState,
  attachmentKey: string,
): Effect.Effect<HistoryOutcome, StepError> {
  return stepHistory(core, attachmentKey, "redo");
}

/**
 * Take one History Step in `direction`: compare what the step left in Zotero
 * with what Zotero holds now, write the far side through this repository's
 * own verbs, and leave the step that write made on the opposite stack.
 *
 * Keys are not queued. A press that meets a guard — no history, a write still
 * in flight on the Attachment, a step already running, nothing left to step —
 * does nothing at all rather than waiting for its turn.
 *
 * @see apps/obsidian/docs/adr/0059-annotation-history-is-per-attachment-checked-by-field-value-and-restores-under-a-new-key.md
 */
const stepHistory = Effect.fnUntraced(function* (
  core: CoreState,
  attachmentKey: string,
  direction: HistoryDirection,
): Effect.fn.Return<HistoryOutcome, StepError> {
  const history = core.histories.get(attachmentKey);
  if (!history || core.steppingAttachments.has(attachmentKey))
    return { kind: "idle" };
  if (savePending(core, attachmentKey)) return { kind: "idle" };
  const step = history.peek(direction);
  if (!step || (yield* beingEdited(core, step))) return { kind: "idle" };
  // An undo is a write, so it needs the Editing Capability like any other,
  // and the existing notice says why it did not run.
  if (yield* writeBlocked(core, attachmentKey)) return { kind: "blocked" };
  // A lock on an Annotation the step writes refuses it before it is taken,
  // so the step stays where it stands, and the press names the Lock Reason.
  const locked = yield* firstHeldLockRefusal(
    core,
    step.changes.map(({ annotationKey }) => annotationKey),
    step.kind,
  );
  if (locked) return { kind: "locked", reason: locked.failure.reason };

  core.steppingAttachments.add(attachmentKey);
  return yield* takeStep(core, step, {
    attachmentKey,
    direction,
    history,
  }).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        core.steppingAttachments.delete(attachmentKey);
        core.publish({ _tag: "history-changed", attachmentKey });
      }),
    ),
  );
});

/**
 * Whether a step stands in this direction that a press would actually take:
 * what {@link AnnotationRepository.canUndo} and
 * {@link AnnotationRepository.canRedo} answer, and what every surface that
 * draws a verb reads.
 */
const stepStands = Effect.fnUntraced(function* (
  core: CoreState,
  attachmentKey: string,
  direction: HistoryDirection,
) {
  const step = core.histories.get(attachmentKey)?.peek(direction);
  return !!step && !(yield* beingEdited(core, step));
});

/**
 * Whether an Annotation Draft stands on an Annotation this step changes: a
 * comment draft, or a tag draft, whether its editor is open or it is held
 * for Save tags with no editor. A draft is a session Zotero does not hold
 * yet. An open comment editor answers these keys with its own text undo,
 * and a tag draft ends by its save or its discard before a step is taken.
 */
const beingEdited = Effect.fnUntraced(function* (
  core: CoreState,
  step: HistoryStep,
) {
  for (const { annotationKey } of step.changes) {
    for (const field of DRAFT_FIELDS) {
      if (yield* draftFor(core, field, annotationKey)) return true;
    }
  }
  return false;
});

/**
 * The field check and the write of one step. Every Annotation the step names
 * is compared before any of them is written, so a step that cannot be taken
 * whole is taken not at all.
 */
const takeStep = Effect.fnUntraced(function* (
  core: CoreState,
  step: HistoryStep,
  {
    attachmentKey,
    direction,
    history,
  }: {
    attachmentKey: string;
    direction: HistoryDirection;
    history: AnnotationHistory;
  },
): Effect.fn.Return<HistoryOutcome, StepError> {
  if (step.kind === "existence") {
    return yield* takeExistenceStep(core, step, {
      attachmentKey,
      direction,
      history,
    });
  }
  if (step.kind === "tags") {
    return yield* takeTagStep(core, step, {
      attachmentKey,
      direction,
      history,
    });
  }
  const checked: { change: HistoryChange; record: AnnotationRecord }[] = [];
  for (const change of step.changes) {
    const record = (yield* holding(core, change.annotationKey))?.record;
    if (record && stillHolds(change.after, record)) {
      checked.push({ change, record });
      continue;
    }
    yield* Effect.logDebug(
      "A history step was dropped: Zotero holds another value",
    ).pipe(
      Effect.annotateLogs({
        attachmentKey,
        annotationKey: change.annotationKey,
        kind: step.kind,
        missing: !record,
      }),
    );
    history.drop(direction, step);
    return { kind: "changed", annotationKey: change.annotationKey };
  }

  const left: HistoryChange[] = [];
  for (const { change, record } of checked) {
    const { annotationKey } = change;
    // The record the write is sent against is the far step's `before`, built
    // the way every step's is.
    const before = historyFieldsOf(step.kind, record) ?? change.after;
    let outcome = yield* stepWrite(core, annotationKey, change.before);
    if (
      outcome.kind === "conflict" &&
      stillHeldAfterConflict(change.after, outcome.conflict)
    ) {
      // The `412` re-read the Annotation and it still holds what the step
      // left there, so only the version moved: send the write once more.
      outcome = yield* stepWrite(core, annotationKey, change.before);
    }
    if (outcome.kind === "failed") {
      // A write Zotero refused has already refreshed the Attachment; one
      // refused before it left ZotLit — an Annotation no list holds, a
      // source that moved, an Editing Capability that lapsed since the press
      // — leaves the Attachment as it stands. Nothing of the step reached
      // Zotero either way, so the step goes with the failure.
      history.drop(direction, step);
      return { kind: "failed", failure: outcome.failure };
    }
    if (outcome.kind !== "idle") {
      yield* discardConflict(core, annotationKey);
      history.drop(direction, step);
      return { kind: "changed", annotationKey };
    }
    const settled = (yield* holding(core, annotationKey))?.record;
    left.push({
      annotationKey,
      before,
      after:
        (settled ? historyFieldsOf(step.kind, settled) : null) ?? change.before,
    });
  }

  history.drop(direction, step);
  history.push(opposite(direction), { kind: step.kind, changes: left });
  return { kind: "stepped", annotationKey: left[0]!.annotationKey };
});

/**
 * Write one side of a History Step through the repository's own verbs, so a
 * step carries the same version stamping, capability gate, conflict handling,
 * and failure path as the edit it steps back. The Annotation is named as the
 * step's own while the write is away, so what it confirms records no step.
 */
function stepWrite(
  core: CoreState,
  annotationKey: string,
  fields: HistoryFields,
): Effect.Effect<MutationState, WriteRunFailed> {
  return Effect.suspend(() => {
    core.steppingWrites.add(annotationKey);
    return fieldWrite(core, annotationKey, fields);
  }).pipe(
    Effect.ensuring(
      Effect.sync(() => core.steppingWrites.delete(annotationKey)),
    ),
  );
}

/** The verb that writes one side of a field step. */
function fieldWrite(
  core: CoreState,
  annotationKey: string,
  fields: HistoryFields,
): Effect.Effect<MutationState, WriteRunFailed> {
  if (fields.color !== undefined) {
    return patchColor(core, annotationKey, fields.color);
  }
  for (const field of TEXT_FIELDS) {
    const value = fields[field];
    if (value !== undefined) {
      return writeText(core, annotationKey, { field, value });
    }
  }
  if (fields.geometry !== undefined) {
    // A step's own write joins nothing: the step it leaves behind is
    // already the one that steps it back.
    return patchGeometry(core, annotationKey, {
      edit: fields.geometry,
      input: "pointer",
    });
  }
  return Effect.succeed(IDLE);
}

/**
 * One tag editing session, taken in the other direction: the names the step
 * added leave the tags Zotero holds now, and the names it removed come back
 * with their old types. No field is compared, so a tag Zotero changed since
 * the session stays; a `412` re-reads the Annotation and applies the same
 * names again, as a session's own save does. The step left for the other
 * direction is what this write confirmed.
 *
 * @see apps/obsidian/docs/adr/0063-annotation-tags-save-once-per-editing-session-and-merge-by-name.md
 */
const takeTagStep = Effect.fnUntraced(function* (
  core: CoreState,
  step: TagHistoryStep,
  {
    attachmentKey,
    direction,
    history,
  }: {
    attachmentKey: string;
    direction: HistoryDirection;
    history: AnnotationHistory;
  },
): Effect.fn.Return<HistoryOutcome, StepError> {
  const [{ annotationKey, tags }] = step.changes;
  const record = (yield* holding(core, annotationKey))?.record;
  if (!record) {
    yield* Effect.logDebug(
      "A history step was dropped: Zotero no longer holds it",
    ).pipe(
      Effect.annotateLogs({ attachmentKey, annotationKey, kind: step.kind }),
    );
    history.drop(direction, step);
    return { kind: "changed", annotationKey };
  }
  // Taking the step writes its change the other way round.
  const reverse: TagChange<AnnotationTag> = {
    added: tags.removed,
    removed: tags.added,
  };
  const current = annotationTags(record);
  if (noTagChange(tagChange(current, mergeTags(current, reverse)))) {
    // An equal value is no conflict: Zotero already holds what the step
    // would write, so it is taken with no write.
    yield* Effect.logDebug(
      "A tag step had nothing to write: Zotero holds its names",
    ).pipe(Effect.annotateLogs({ attachmentKey, annotationKey }));
    history.drop(direction, step);
    return { kind: "stepped", annotationKey };
  }

  let sent = record;
  core.steppingWrites.add(annotationKey);
  const outcome = yield* command(core, annotationKey, {
    write: "tags",
    request: (target, against) => {
      sent = against;
      return tagsPatch(target, mergeTags(annotationTags(against), reverse));
    },
    propose: (against) =>
      proposedTags(mergeTags(annotationTags(against), reverse)),
  }).pipe(
    Effect.ensuring(
      Effect.sync(() => core.steppingWrites.delete(annotationKey)),
    ),
  );
  history.drop(direction, step);
  if (outcome.kind === "failed") {
    return { kind: "failed", failure: outcome.failure };
  }
  const settled = (yield* holding(core, annotationKey))?.record;
  const left =
    settled && tagChange(annotationTags(sent), annotationTags(settled));
  if (left && !noTagChange(left)) {
    history.push(opposite(direction), {
      kind: step.kind,
      changes: [{ annotationKey, tags: left }],
    });
  }
  return { kind: "stepped", annotationKey };
});

/**
 * One step of creates and deletes, taken in the other direction: what the
 * step made is erased, and what it erased is created again.
 *
 * Every Annotation the step names is compared before any of them is written,
 * so a stroke split into several Annotations is taken whole or not at all.
 * Zotero refuses a client-supplied key, so a restore comes back under a new
 * one and both stacks answer for it from then on.
 *
 * @see apps/obsidian/docs/adr/0059-annotation-history-is-per-attachment-checked-by-field-value-and-restores-under-a-new-key.md
 */
const takeExistenceStep = Effect.fnUntraced(function* (
  core: CoreState,
  step: FieldHistoryStep,
  {
    attachmentKey,
    direction,
    history,
  }: {
    attachmentKey: string;
    direction: HistoryDirection;
    history: AnnotationHistory;
  },
): Effect.fn.Return<HistoryOutcome, StepError> {
  for (const change of step.changes) {
    const record = (yield* holding(core, change.annotationKey))?.record ?? null;
    if (sameContent(change.after.content ?? null, record)) continue;
    yield* Effect.logDebug(
      "A history step was dropped: Zotero holds another value",
    ).pipe(
      Effect.annotateLogs({
        attachmentKey,
        annotationKey: change.annotationKey,
        kind: step.kind,
        missing: !record,
      }),
    );
    history.drop(direction, step);
    return { kind: "changed", annotationKey: change.annotationKey };
  }

  // The step leaves its stack before the first write rather than after the
  // last: a restore renames the old key in every step that names it, this
  // one included, so a step taken off by name afterwards would no longer be
  // the step this stack holds.
  history.drop(direction, step);

  const left: HistoryChange[] = [];
  let removed: { annotationKey: string; pageIndex: number } | null = null;
  for (const change of step.changes) {
    const wanted = change.before.content ?? null;
    const standing = change.after.content;
    if (wanted === null) {
      if (!standing) continue;
      const erased = yield* deleteAnnotation(core, change.annotationKey);
      if (erased.kind === "failed") {
        return { kind: "failed", failure: erased.failure };
      }
      if (erased.kind !== "idle") {
        yield* discardConflict(core, change.annotationKey);
        return { kind: "changed", annotationKey: change.annotationKey };
      }
      removed ??= {
        annotationKey: change.annotationKey,
        pageIndex: standing.position.pageIndex,
      };
      left.push({
        annotationKey: change.annotationKey,
        before: { content: standing },
        after: { content: null },
      });
      continue;
    }
    const made = yield* createAnnotation(core, attachmentKey, {
      draft: wanted,
    });
    if (made.kind === "failed") {
      return { kind: "failed", failure: made.failure };
    }
    // Zotero named the restored Annotation itself, so every step of both
    // stacks that asked after the old key asks after this one now.
    history.rename(change.annotationKey, made.annotationKey);
    const settled = (yield* holding(core, made.annotationKey))?.record ?? null;
    left.push({
      annotationKey: made.annotationKey,
      before: { content: null },
      after: { content: (settled && contentOf(settled)) ?? wanted },
    });
  }

  history.push(opposite(direction), { ...step, changes: left });
  if (removed) return { kind: "removed", ...removed };
  // Zotero restores another user's Annotation with the current user as its
  // creator, so the lock it stood under does not come back with it.
  const count = step.changes.filter(
    (change) => isRestore(change) && change.lock === "another-user",
  ).length;
  yield* Effect.logDebug("An existence step was taken").pipe(
    Effect.annotateLogs({
      attachmentKey,
      direction,
      restored: step.changes.filter(isRestore).length,
      restoredAsCreator: count,
    }),
  );
  return {
    kind: "stepped",
    annotationKey: left[0]!.annotationKey,
    ...(count > 0 && { restoredAsCreator: { count } }),
  };
});

/**
 * Whether a save on this Attachment is on its way or still due: a write in
 * flight, or an Annotation Draft whose autosave timer is armed. A press of
 * the Annotation History's keys does nothing while one stands, rather than
 * stepping past a save that would then land on top of it.
 */
function savePending(core: CoreState, attachmentKey: string): boolean {
  if ((core.writesInFlight.get(attachmentKey) ?? 0) > 0) return true;
  for (const field of TEXT_FIELDS) {
    for (const draft of core.drafts[field].values()) {
      if (draft.attachmentKey !== attachmentKey) continue;
      if (autosaveDue(core, field, draft)) return true;
    }
  }
  return false;
}

export { openHistory, closeHistory, canUndo, canRedo, undo, redo };
