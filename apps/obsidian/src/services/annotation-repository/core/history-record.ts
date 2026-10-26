// How a confirmed write is recorded as a History Step in an open Annotation History.
import { getLogger } from "@/lib/log";
import {
  contentOf,
  historyFieldsOf,
} from "@/services/annotation-repository/history";
import type {
  FieldHistoryStep,
  HistoryChange,
  HistoryJoin,
  HistoryStep,
  AnnotationHistory,
} from "@/services/annotation-repository/history";
import {
  annotationTags,
  isTextField,
  noTagChange,
  tagChange,
} from "@/services/annotation-repository/write";
import type { TextField } from "@/services/annotation-repository/write";

import { TEXT_FIELD_SPECS, sameText } from "./model";
import type {
  AnnotationRecord,
  ConfirmedWrite,
  GroupWrite,
  GroupWrites,
} from "./model";
import type { CoreState } from "./state";

const logger = getLogger("annotation-repository");

/**
 * What one confirmed write changed, as the History Step that puts it back
 * names it: a delete the whole Annotation, a patch of one field that field's
 * value. A comment session, a Text Edit session, and a tag session are
 * recorded by rules of their own, and have no change here.
 */
function historyChangeOf(
  before: AnnotationRecord,
  applied: ConfirmedWrite,
): { kind: FieldHistoryStep["kind"]; change: HistoryChange } | null {
  if (applied.kind === "deleted") {
    const content = contentOf(before);
    return content
      ? {
          kind: "existence",
          change: {
            annotationKey: applied.annotationKey,
            before: { content },
            after: { content: null },
            ...(applied.lock && { lock: applied.lock }),
          },
        }
      : null;
  }
  if (
    applied.kind !== "record" ||
    applied.write === "tags" ||
    isTextField(applied.write)
  )
    return null;
  const was = historyFieldsOf(applied.write, before);
  const now = historyFieldsOf(applied.write, applied.record);
  return was && now
    ? {
        kind: applied.write,
        change: { annotationKey: applied.record.key, before: was, after: now },
      }
    : null;
}

/**
 * Take one confirmed edit into the Attachment's Annotation History.
 *
 * Nothing is recorded while no PDF view of the Attachment holds a history
 * open, and an undo's own write records nothing: the step it leaves behind is
 * already the one that steps it back.
 *
 * @param before the held record the write was sent against.
 * @param confirmed.applied what Zotero answered the write with.
 * @param confirmed.join what this edit joins the step before it by, where it
 *   came from an input that runs.
 */
function recordStep(
  core: CoreState,
  attachmentKey: string,
  before: AnnotationRecord,
  { applied, join }: { applied: ConfirmedWrite; join?: HistoryJoin },
): void {
  const history = core.histories.get(attachmentKey);
  if (!history || core.steppingWrites.has(before.key)) return;
  if (applied.kind === "record" && applied.write === "tags") {
    recordTagStep(core, history, {
      attachmentKey,
      before,
      record: applied.record,
    });
    return;
  }
  if (applied.kind === "record" && isTextField(applied.write)) {
    recordTextStep(core, history, applied.write, {
      attachmentKey,
      before,
      record: applied.record,
    });
    return;
  }
  const made = historyChangeOf(before, applied);
  if (!made) return;
  if (made.kind === "existence") {
    recordExistence(core, attachmentKey, made.change);
    return;
  }
  const joined = history.record({
    kind: made.kind,
    changes: [made.change],
    ...(join && { join }),
  });
  logger.debug("An edit was recorded in the annotation history", {
    attachmentKey,
    annotationKey: made.change.annotationKey,
    kind: made.kind,
    joined,
  });
  core.publish({ _tag: "history-changed", attachmentKey });
}

/**
 * Take one confirmed write of a text field — the comment or the Quoted Text —
 * into the step its editing session is shaping. One editing session is one
 * History Step: the first save of a session records the step from the text
 * the field held when the session began, every later save moves only its
 * `after`, and a session that settles on the text it began with leaves no
 * step at all.
 *
 * The session is read off the history rather than off the Annotation Draft,
 * which the repository drops and remakes around each settled save: a write
 * joins the step on top where that step is this Annotation's own step of
 * the same field and the write was stamped off the text it left in Zotero,
 * and starts a fresh one otherwise. So a colour pick between two sessions
 * keeps them apart, a text changed in Zotero between two saves keeps them
 * apart too, and the Mark Popup handing the comment editor to an Annotation
 * Card keeps them one.
 */
function recordTextStep(
  core: CoreState,
  history: AnnotationHistory,
  field: TextField,
  {
    attachmentKey,
    before,
    record,
  }: {
    attachmentKey: string;
    /** The record the write was stamped off. */
    before: AnnotationRecord;
    /** The record Zotero confirmed. */
    record: AnnotationRecord;
  },
): void {
  const { valueOf } = TEXT_FIELD_SPECS[field];
  const top = history.peek("undo");
  const open =
    top?.kind === field &&
    top.changes.length === 1 &&
    top.changes[0]!.annotationKey === record.key &&
    // The write was stamped off the very text that step left in Zotero, so
    // the two saves are one session. A text changed in Zotero between them
    // moves the record the next write is stamped off: that session is over,
    // and a fresh step starts holding the foreign text, so one press puts
    // that back rather than the text the session began with.
    sameText(valueOf(before), top.changes[0]!.after[field] ?? null)
      ? top
      : null;
  // A step's own `before` never moves, so the session reads its starting
  // text from there rather than from the draft's baseline, which the last
  // save advanced.
  const origin = open?.changes[0]!.before[field] ?? valueOf(before) ?? "";
  const after = valueOf(record) ?? "";
  const step: HistoryStep | null = sameText(origin, after)
    ? null
    : {
        kind: field,
        changes: [
          {
            annotationKey: record.key,
            before: { [field]: origin },
            after: { [field]: after },
          },
        ],
      };
  if (open) history.reshape(open, step);
  else if (step) history.record(step);
  else return;
  logger.debug("A text editing session moved in the annotation history", {
    attachmentKey,
    annotationKey: record.key,
    field,
    recorded: !!step,
  });
  core.publish({ _tag: "history-changed", attachmentKey });
}

/**
 * Take one confirmed tag session into the Attachment's Annotation History,
 * as one step holding the names it added and removed with their types. The
 * names are read off the two records around the write, so a session whose
 * names Zotero already held leaves no step.
 *
 * @see apps/obsidian/docs/adr/0063-annotation-tags-save-once-per-editing-session-and-merge-by-name.md
 */
function recordTagStep(
  core: CoreState,
  history: AnnotationHistory,
  {
    attachmentKey,
    before,
    record,
  }: {
    attachmentKey: string;
    /** The record the write was built against. */
    before: AnnotationRecord;
    /** The record Zotero confirmed. */
    record: AnnotationRecord;
  },
): void {
  const tags = tagChange(annotationTags(before), annotationTags(record));
  if (noTagChange(tags)) return;
  history.record({
    kind: "tags",
    changes: [{ annotationKey: record.key, tags }],
  });
  logger.debug("A tag session was recorded in the annotation history", {
    attachmentKey,
    annotationKey: record.key,
    added: tags.added.length,
    removed: tags.removed.length,
  });
  core.publish({ _tag: "history-changed", attachmentKey });
}

/**
 * Take the writes of one group that landed on one Attachment into its
 * Annotation History as one step, in the order of `annotationKeys`: the
 * order the gesture named them in, the Card Selection's list order. A group
 * where nothing landed records nothing.
 *
 * The group's kind is the step's kind. A landed write that changed another
 * kind of step is a caller's mistake: it is refused from the step and
 * logged, rather than letting any one write decide what the step is.
 *
 * @param group.writes the landed writes on this Attachment.
 */
function recordGroup(
  core: CoreState,
  attachmentKey: string,
  annotationKeys: readonly string[],
  { kind, writes }: GroupWrites,
): void {
  const history = core.histories.get(attachmentKey);
  if (!history || core.steppingAttachments.has(attachmentKey)) return;
  const order = (entry: GroupWrite) => annotationKeys.indexOf(entry.before.key);
  const changes: HistoryChange[] = [];
  for (const { before, applied } of writes.toSorted(
    (a, b) => order(a) - order(b),
  )) {
    if (core.steppingWrites.has(before.key)) continue;
    const made = historyChangeOf(before, applied);
    if (!made) continue;
    if (made.kind === kind) {
      changes.push(made.change);
      continue;
    }
    logger.error("A write of a group changed another kind of step", {
      attachmentKey,
      annotationKey: before.key,
      group: kind,
      write: made.kind,
    });
  }
  if (changes.length === 0) return;
  history.record({ kind, changes });
  logger.debug("A group write was recorded in the history as one step", {
    attachmentKey,
    kind,
    annotations: changes.length,
  });
  core.publish({ _tag: "history-changed", attachmentKey });
}

/**
 * Take one confirmed create or delete into the Attachment's Annotation
 * History, under the same rules every other edit is recorded under.
 *
 * A restore comes back under a key Zotero picks, which no caller can name in
 * advance, so a running step keeps its own creates out by the Attachment it
 * runs on rather than by the Annotation every other kind names.
 *
 * @param group what joins this create to the others of one gesture, where one
 *   gesture created several Annotations.
 */
function recordExistence(
  core: CoreState,
  attachmentKey: string,
  change: HistoryChange,
  group?: string,
): void {
  const history = core.histories.get(attachmentKey);
  if (!history || core.steppingAttachments.has(attachmentKey)) return;
  history.record({
    kind: "existence",
    changes: [change],
    ...(group !== undefined && { group }),
  });
  logger.debug("A create or a delete was recorded in the history", {
    attachmentKey,
    annotationKey: change.annotationKey,
    restores: change.before.content !== null,
  });
  core.publish({ _tag: "history-changed", attachmentKey });
}

export { recordStep, recordGroup, recordExistence };
