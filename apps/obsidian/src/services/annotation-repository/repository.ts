// The Annotations of one Attachment, read from one Annotation Source at a time.
import { getLogger } from "@/lib/log";
import type { Held } from "@/services/query-client/service";
import { changed } from "@/services/zotero-reads/events";

import type { EditingCapability } from "./capability";
import { demandedSource } from "./core/bridge";
import {
  cancelAllTextSaves,
  cancelTextSave,
  clearTextTimers,
  draftFor,
  draftsOn,
  dropDraft,
  setDraft,
  textSave,
} from "./core/draft-store";
import {
  capability,
  capabilityFor,
  dropDatabasePartition,
  hold,
  holding,
  peek,
  probe,
  read,
  refresh,
  refreshLocks,
  sourceMoved,
} from "./core/lists";
import {
  DRAFT_FIELDS,
  TEXT_FIELD_SPECS,
  indexedID,
  proposedTags,
  proposedText,
  sameText,
} from "./core/model";
import type {
  AnnotationList,
  AnnotationMutation,
  AnnotationRecord,
  AnnotationRepositoryCoreDeps,
  AnnotationState,
  TagDraft,
  TextFieldDraft,
} from "./core/model";
import {
  answerOf,
  mutationFor,
  pendingWrites,
  savingText,
  settle,
} from "./core/outcomes";
import { CoreState } from "./core/state";
import {
  command,
  createAnnotation,
  deleteAnnotation,
  deleteAnnotations,
  discardConflict,
  firstHeldLockRefusal,
  lockRefusal,
  patchColor,
  patchColors,
  patchComment,
  patchGeometry,
  retryWrite,
  writeBlocked,
  writeText,
} from "./core/writes";
import type { CreateOutcome } from "./core/writes";
import {
  AnnotationHistory,
  contentOf,
  historyFieldsOf,
  isRestore,
  opposite,
  sameContent,
  stillHeldAfterConflict,
  stillHolds,
} from "./history";
import type {
  FieldHistoryStep,
  HistoryChange,
  HistoryDirection,
  HistoryFields,
  HistoryOutcome,
  HistoryStep,
  TagHistoryStep,
} from "./history";
import {
  annotationTags,
  byTextField,
  IDLE,
  mergeTags,
  noTagChange,
  tagChange,
  tagsPatch,
  TEXT_FIELDS,
} from "./write";
import type {
  AnnotationDraft,
  AnnotationTag,
  GeometryEdit,
  GeometryInput,
  MutationState,
  TagChange,
  TextField,
} from "./write";
export type { CreateOutcome } from "./core/writes";
export { UNHELD_RETENTION, LocalApiReadFailed } from "./core/lists";
export type {
  DatabaseAnnotationSource,
  AnnotationSource,
  AnnotationRecord,
  AnnotationList,
  TextFieldDraftState,
  TextFieldDraft,
  TagDraftState,
  TagDraft,
  AnnotationState,
  AnnotationRepositoryEvent,
  AnnotationRepositoryCoreDeps,
} from "./core/model";

export type { EditingCapability } from "./capability";
export type { AnnotationLock, LockReason } from "./lock";
export type {
  HistoryDirection,
  HistoryEditKind,
  HistoryOutcome,
  HistoryStep,
} from "./history";
export type {
  AnnotationDraft,
  GeometryEdit,
  GeometryInput,
  MutationState,
  TextField,
  WriteConflict,
  WriteFailure,
} from "./write";

const logger = getLogger("annotation-repository");

const TEXT_IDLE_SAVE_MS = 1_000;
const TEXT_BURST_SAVE_MS = 10_000;

type TextWriteDecision =
  | { kind: "drop" }
  | { kind: "retain" }
  | { kind: "update"; draft: TextFieldDraft };

/** Decide what one completed text field request leaves in repository memory. */
function textDraftAfterWrite(
  current: TextFieldDraft,
  submittedText: string,
  outcome: MutationState,
): TextWriteDecision {
  switch (outcome.kind) {
    case "idle":
      return sameText(current.text, submittedText)
        ? { kind: "drop" }
        : {
            kind: "update",
            draft: {
              ...current,
              baseline: submittedText,
              // A save that landed ends the hold, so newer text autosaves.
              manualSave: false,
              state: { kind: "editing" },
            },
          };
    case "conflict": {
      // A text field's write conflicts over its text; only a Geometry Edit's
      // conflict carries no text to hold.
      const { conflict } = outcome;
      const fresh = conflict.write === "geometry" ? "" : (conflict.fresh ?? "");
      return {
        kind: "update",
        draft: { ...current, state: { kind: "conflict", fresh } },
      };
    }
    case "failed":
      return {
        kind: "update",
        draft: {
          ...current,
          manualSave: true,
          state: { kind: "failed", failure: outcome.failure },
        },
      };
    case "pending":
      return { kind: "retain" };
  }
}

/**
 * Answers an Attachment's Annotations from the Annotation Source that is active
 * for it, and says which source answered. Reads are held on the plugin-wide
 * query client, so the overlay and the Annotation View asking for one Attachment
 * at once cost one database read.
 *
 * It is also the one write path. A command takes Indexed Keys alone: the record
 * the active source answered supplies the version the write sends as its
 * precondition, and a record with no version — the Zotero DB source's — refuses
 * the write before any request. Each write is a mutation on the plugin-wide
 * query client, run one at a time per Annotation, and its variables are its
 * Pending Proposal: every list this repository publishes draws the proposal in
 * place of the confirmed fields until the write settles, and the query cache
 * behind it keeps the confirmed record every write, conflict, and History Step
 * is decided against.
 *
 * The Zotero DB partition is dropped wholesale whenever the database refreshes,
 * and the Zotero Local API partition whenever that source moves — a Freshness
 * Signal, another Zotero database, a capability that changed. Every Attachment
 * the drop concerns is announced through `annotations-changed`, which is the
 * only signal that a list was superseded, and read again here, so the pixels
 * such a change moved are announced even with no surface mounted to ask.
 *
 * A surface holds the lists it shows through {@link AnnotationRepository.hold}
 * and reads them through {@link AnnotationRepository.read}: the reads it asks
 * in one task the Zotero DB source answers in one batch read. A list no surface
 * holds any more is let go, so a view over a whole Library leaves nothing
 * behind.
 *
 * @see apps/obsidian/docs/adr/0034-the-annotation-source-is-atomic-per-attachment.md
 * @see docs/adr/0060-held-reads-are-realized-on-tanstack-query-core.md
 */
export class AnnotationRepositoryCore implements AsyncDisposable {
  readonly #core: CoreState;
  readonly #stack = new AsyncDisposableStack();

  constructor(deps: AnnotationRepositoryCoreDeps) {
    const core = new CoreState(deps);
    this.#core = core;
    this.#stack.defer(
      core.bridge.subscribe(changed(core.db), () => {
        dropDatabasePartition(core);
        void refreshLocks(core);
      }),
    );
    this.#stack.defer(
      core.bridge.subscribe(core.localApi.changes, () => sourceMoved(core)),
    );
    this.#stack.defer(
      core.bridge.subscribe(core.localApi.capabilityChanges, () => {
        for (const field of TEXT_FIELDS) {
          const drafts = core.drafts[field];
          for (const [id, draft] of drafts) {
            if (capabilityFor(core, draft.attachmentKey).kind === "writable")
              continue;
            cancelTextSave(core, field, draft);
            drafts.set(id, { ...draft, manualSave: true });
            core.publish({
              _tag: "annotation-changed",
              annotationKey: draft.annotationKey,
            });
          }
        }
        // A tag draft has no timer or queued save to cancel, unlike a text
        // draft, so one already held needs no second event.
        for (const draft of core.drafts.tags.values()) {
          if (
            draft.manualSave ||
            capabilityFor(core, draft.attachmentKey).kind === "writable"
          )
            continue;
          setDraft(core, "tags", { ...draft, manualSave: true });
        }
        core.publish({ _tag: "capability-changed" });
      }),
    );
    this.#stack.defer(() => cancelAllTextSaves(core));
    this.#stack.defer(() => {
      core.commandGeneration += 1;
    });
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.#stack.disposeAsync();
  }

  read(attachmentKey: string): Promise<AnnotationList | null> {
    return read(this.#core, attachmentKey);
  }

  hold(attachmentKeys: Iterable<string>): Disposable {
    return hold(this.#core, attachmentKeys);
  }

  refresh(attachmentKey: string): Promise<AnnotationList | null> {
    return refresh(this.#core, attachmentKey);
  }

  peek(attachmentKey: string): Held<AnnotationList> | null {
    return peek(this.#core, attachmentKey);
  }

  capabilityFor(attachmentKey: string): EditingCapability {
    return capabilityFor(this.#core, attachmentKey);
  }

  get capability(): EditingCapability {
    return capability(this.#core);
  }

  probe(): Promise<void> {
    return probe(this.#core);
  }

  mutationFor(annotationKey: string): MutationState {
    return mutationFor(this.#core, annotationKey);
  }

  annotationState(annotationKey: string): AnnotationState {
    return annotationState(this.#core, annotationKey);
  }

  textDraftFor(field: TextField, annotationKey: string): TextFieldDraft | null {
    return textDraftFor(this.#core, field, annotationKey);
  }

  editTextField(
    field: TextField,
    annotationKey: string,
    text?: string,
  ): TextFieldDraft | null {
    return editTextField(this.#core, field, annotationKey, text);
  }

  submitTextField(
    field: TextField,
    annotationKey: string,
    options: { automatic?: boolean } = {},
  ): Promise<MutationState> {
    return submitTextField(this.#core, field, annotationKey, options);
  }

  discardTextDraft(field: TextField, annotationKey: string): void {
    return discardTextDraft(this.#core, field, annotationKey);
  }

  retryTextDraft(
    field: TextField,
    annotationKey: string,
  ): Promise<MutationState> {
    return retryTextDraft(this.#core, field, annotationKey);
  }

  tagDraftFor(annotationKey: string): TagDraft | null {
    return tagDraftFor(this.#core, annotationKey);
  }

  editTags(annotationKey: string, names?: readonly string[]): TagDraft | null {
    return editTags(this.#core, annotationKey, names);
  }

  submitTags(
    annotationKey: string,
    options: { automatic?: boolean } = {},
  ): Promise<MutationState> {
    return submitTags(this.#core, annotationKey, options);
  }

  discardTagDraft(annotationKey: string): void {
    return discardTagDraft(this.#core, annotationKey);
  }

  createAnnotation(
    attachmentKey: string,
    draft: Omit<AnnotationDraft, "parentKey">,
    options: { group?: string } = {},
  ): Promise<CreateOutcome> {
    return createAnnotation(this.#core, attachmentKey, draft, options);
  }

  patchColor(annotationKey: string, color: string): Promise<MutationState> {
    return patchColor(this.#core, annotationKey, color);
  }

  patchColors(
    annotationKeys: readonly string[],
    color: string,
  ): Promise<MutationState[]> {
    return patchColors(this.#core, annotationKeys, color);
  }

  patchComment(annotationKey: string, comment: string): Promise<MutationState> {
    return patchComment(this.#core, annotationKey, comment);
  }

  patchGeometry(
    annotationKey: string,
    edit: GeometryEdit,
    input: GeometryInput,
  ): Promise<MutationState> {
    return patchGeometry(this.#core, annotationKey, edit, input);
  }

  deleteAnnotation(annotationKey: string): Promise<MutationState> {
    return deleteAnnotation(this.#core, annotationKey);
  }

  deleteAnnotations(
    annotationKeys: readonly string[],
  ): Promise<MutationState[]> {
    return deleteAnnotations(this.#core, annotationKeys);
  }

  retryWrite(annotationKey: string): Promise<MutationState> {
    return retryWrite(this.#core, annotationKey);
  }

  discardConflict(annotationKey: string): void {
    return discardConflict(this.#core, annotationKey);
  }

  openHistory(attachmentKey: string): void {
    return openHistory(this.#core, attachmentKey);
  }

  closeHistory(attachmentKey: string): void {
    return closeHistory(this.#core, attachmentKey);
  }

  canUndo(attachmentKey: string): boolean {
    return canUndo(this.#core, attachmentKey);
  }

  canRedo(attachmentKey: string): boolean {
    return canRedo(this.#core, attachmentKey);
  }

  undo(attachmentKey: string): Promise<HistoryOutcome> {
    return undo(this.#core, attachmentKey);
  }

  redo(attachmentKey: string): Promise<HistoryOutcome> {
    return redo(this.#core, attachmentKey);
  }
}

/**
 * Everything the repository holds about one Annotation beside its record.
 *
 * @param annotationKey the Annotation's Indexed Key.
 */
function annotationState(
  core: CoreState,
  annotationKey: string,
): AnnotationState {
  const textDrafts = byTextField((field) =>
    draftFor(core, field, annotationKey),
  );
  const tagDraft = tagDraftFor(core, annotationKey);
  const shown = new Set<TextFieldDraft | TagDraft>(
    [...Object.values(textDrafts), tagDraft].filter((draft) => draft !== null),
  );
  return {
    mutation: mutationFor(core, annotationKey),
    textDrafts,
    tagDraft,
    hidden: draftsOn(core, annotationKey).some((draft) => !shown.has(draft)),
    gone: core.gone.has(annotationKey),
  };
}

/**
 * The active Zotero database's shared draft of one text field of an
 * Annotation: its comment or its Quoted Text.
 */
function textDraftFor(
  core: CoreState,
  field: TextField,
  annotationKey: string,
): TextFieldDraft | null {
  return draftFor(core, field, annotationKey);
}

/**
 * Start or update one shared text field draft: a comment edit, or a Text
 * Edit on the Quoted Text. Without `text`, the draft starts from the
 * confirmed value, or stays as it stands.
 *
 * @returns the draft, or `null` where none can start.
 */
function editTextField(
  core: CoreState,
  field: TextField,
  annotationKey: string,
  text?: string,
): TextFieldDraft | null {
  const source = demandedSource(core);
  const standing = draftFor(core, field, annotationKey);
  const held = standing ? null : holding(core, annotationKey);
  if (!standing && (!source || !held)) return null;
  const capability = capabilityFor(
    core,
    standing?.attachmentKey ?? held!.attachmentKey,
  );
  if (capability.kind !== "writable") return standing ?? null;
  // A lock takes no keystroke either: a draft already standing is held.
  if (lockRefusal(core, annotationKey, field)) return standing ?? null;
  const baseline =
    standing?.baseline ?? TEXT_FIELD_SPECS[field].valueOf(held!.record) ?? "";
  const draft = standing
    ? {
        ...standing,
        ...(text !== undefined && { text }),
        // A new keystroke clears the last failure; re-sending the same
        // text does not, so the reason stays on the card until the user
        // writes something else or saves again.
        ...(text !== undefined &&
          text !== standing.text &&
          standing.state.kind === "failed" && {
            state: { kind: "editing" } as const,
          }),
      }
    : {
        annotationKey,
        attachmentKey: held!.attachmentKey,
        serverID: source!.serverID,
        baseline,
        text: text ?? baseline,
        state: { kind: "editing" } as const,
      };
  setDraft(core, field, draft);
  if (text !== undefined && draft.state.kind !== "conflict") {
    scheduleTextSave(core, field, draft);
  }
  return draft;
}

/** Submit one text field's current shared draft once. */
function submitTextField(
  core: CoreState,
  field: TextField,
  annotationKey: string,
  { automatic = false }: { automatic?: boolean } = {},
): Promise<MutationState> {
  const draft = draftFor(core, field, annotationKey);
  if (!draft) return Promise.resolve(IDLE);
  clearTextTimers(
    core,
    textSave(core, field, indexedID(draft.serverID, annotationKey)),
  );
  if (draft.state.kind === "conflict") {
    return Promise.resolve(mutationFor(core, annotationKey));
  }
  const saving = savingText(core, field, annotationKey);
  // A draft holding what Zotero already has is not a draft: it is dropped
  // ahead of every other answer, so an editor the user opened and closed
  // without typing leaves nothing behind for a card to announce. Manual-save
  // mode does not hold it either — there is nothing there to save.
  if (!saving && sameText(draft.text, draft.baseline)) {
    dropDraft(core, field, draft);
    return Promise.resolve(IDLE);
  }
  // Text a save already carries needs no second one.
  if (saving && sameText(proposedText(field, saving), draft.text)) {
    return answerOf(core, saving);
  }
  // Text typed while a save is in flight queues behind it, even behind the
  // Save comment pressed on a held draft, which that save's success ends.
  if (!saving) {
    if (automatic && !canAutosave(core, draft)) return Promise.resolve(IDLE);
    const capability = capabilityFor(core, draft.attachmentKey);
    if (capability.kind !== "writable")
      return Promise.resolve({
        kind: "failed",
        failure: writeBlocked(core, draft.attachmentKey)!,
      });
  }
  // A lock refuses the draft before it turns pending, queued or not.
  const locked = lockRefusal(core, annotationKey, field);
  if (locked) return Promise.resolve({ kind: "failed", failure: locked });
  const submittedText = draft.text;
  setDraft(core, field, { ...draft, state: { kind: "pending" } });
  return sendText(core, field, draft, { submittedText, automatic });
}

async function sendText(
  core: CoreState,
  field: TextField,
  { annotationKey, serverID }: TextFieldDraft,
  { submittedText, automatic }: { submittedText: string; automatic: boolean },
): Promise<MutationState> {
  const id = indexedID(serverID, annotationKey);
  return await writeText(core, field, annotationKey, {
    value: submittedText,
    // The draft takes the save's outcome before the next write on the
    // Annotation starts, so a save queued behind a failed one is held.
    run: async (send, own) => {
      if (textSuperseded(core, field, own, { annotationKey, id, automatic })) {
        logger.debug("A queued text save stood down", {
          annotationKey,
          field,
        });
        return { kind: "pending", write: field };
      }
      const outcome = await send();
      const current = core.drafts[field].get(id);
      if (current && current.state.kind !== "conflict") {
        applyTextWriteDecision(core, field, {
          annotationKey,
          current,
          submittedText,
          outcome,
          own,
        });
      }
      return outcome;
    },
  });
}

/**
 * Whether a text save that waited its turn is no longer needed: a later
 * save of the same field or a delete on the same Annotation replaces it, or
 * its draft ended, met a conflict, or was held by a failed save while it
 * waited. An automatic save also stands down where autosave is off.
 */
function textSuperseded(
  core: CoreState,
  field: TextField,
  own: AnnotationMutation,
  {
    annotationKey,
    id,
    automatic,
  }: { annotationKey: string; id: string; automatic: boolean },
): boolean {
  const current = core.drafts[field].get(id);
  if (
    !current ||
    current.state.kind === "conflict" ||
    current.state.kind === "failed" ||
    (automatic && !canAutosave(core, current))
  ) {
    return true;
  }
  const writes = pendingWrites(core, annotationKey);
  return writes.slice(writes.indexOf(own) + 1).some(({ options }) => {
    const write = options.mutationKey?.[2];
    return write === field || write === "delete";
  });
}

/** Keep Zotero's reviewed value of one text field and discard the draft. */
function discardTextDraft(
  core: CoreState,
  field: TextField,
  annotationKey: string,
): void {
  const draft = draftFor(core, field, annotationKey);
  if (draft) dropDraft(core, field, draft);
  if (core.outcomes.get(annotationKey)?.get(field)?.kind === "conflict") {
    settle(core, annotationKey, field, IDLE);
  }
}

/** Apply one text field's shared draft again against the reviewed fresh record. */
function retryTextDraft(
  core: CoreState,
  field: TextField,
  annotationKey: string,
): Promise<MutationState> {
  const draft = draftFor(core, field, annotationKey);
  if (!draft) return Promise.resolve(IDLE);
  clearTextTimers(
    core,
    textSave(core, field, indexedID(draft.serverID, annotationKey)),
  );
  const saving = savingText(core, field, annotationKey);
  if (saving) return answerOf(core, saving);
  // The draft and its Write Conflict stay as they stand.
  const locked = lockRefusal(core, annotationKey, field);
  if (locked) return Promise.resolve({ kind: "failed", failure: locked });
  return resendText(core, field, annotationKey, draft);
}

async function resendText(
  core: CoreState,
  field: TextField,
  annotationKey: string,
  draft: TextFieldDraft,
): Promise<MutationState> {
  const held = holding(core, annotationKey);
  const reviewed =
    draft.state.kind === "conflict" ? draft.state.fresh : draft.baseline;
  const fresh = (held && TEXT_FIELD_SPECS[field].valueOf(held.record)) ?? "";
  if (!held || !sameText(fresh, reviewed)) {
    const outcome: MutationState = {
      kind: "conflict",
      conflict: { write: field, attempted: draft.text, fresh },
    };
    settle(core, annotationKey, field, outcome);
    setDraft(core, field, { ...draft, state: { kind: "conflict", fresh } });
    if (held) {
      core.publish({
        _tag: "write-conflict",
        annotationKey,
        attachmentKey: held.attachmentKey,
      });
    }
    return outcome;
  }
  const submittedText = draft.text;
  const id = indexedID(draft.serverID, annotationKey);
  setDraft(core, field, { ...draft, state: { kind: "pending" } });
  let outcome = await writeText(core, field, annotationKey, {
    value: submittedText,
  });
  if (
    outcome.kind === "conflict" &&
    outcome.conflict.write === field &&
    sameText(outcome.conflict.fresh, reviewed)
  ) {
    outcome = await writeText(core, field, annotationKey, {
      value: submittedText,
    });
  }
  const current = core.drafts[field].get(id);
  if (!current) return outcome;
  applyTextWriteDecision(core, field, {
    annotationKey,
    current,
    submittedText,
    outcome,
  });
  return outcome;
}

function applyTextWriteDecision(
  core: CoreState,
  field: TextField,
  {
    annotationKey,
    current,
    submittedText,
    outcome,
    own,
  }: {
    annotationKey: string;
    current: TextFieldDraft;
    submittedText: string;
    outcome: MutationState;
    /** The write that answered, while it still counts as in flight. */
    own?: AnnotationMutation;
  },
): void {
  const decision = textDraftAfterWrite(current, submittedText, outcome);
  const later = savingText(core, field, annotationKey);
  // A later save of the draft is still on its way.
  if (
    decision.kind === "update" &&
    decision.draft.state.kind === "editing" &&
    later &&
    later !== own
  ) {
    decision.draft = { ...decision.draft, state: { kind: "pending" } };
  }
  if (decision.kind === "drop") {
    dropDraft(core, field, current);
  } else if (decision.kind === "update") {
    core.drafts[field].set(
      indexedID(current.serverID, annotationKey),
      decision.draft,
    );
    core.publish({ _tag: "annotation-changed", annotationKey });
    // Text typed while the save was away, even behind a Save comment
    // pressed on a held draft, whose success ends the hold, is sent now.
    if (outcome.kind === "idle" && decision.draft.state.kind === "editing") {
      void submitTextField(core, field, annotationKey, { automatic: true });
    }
  }
}

/** The active Zotero database's shared tag draft for one Annotation. */
function tagDraftFor(core: CoreState, annotationKey: string): TagDraft | null {
  return draftFor(core, "tags", annotationKey);
}

/**
 * Start or update one tag editing session. A session starts from the
 * confirmed names and only while editing is available. A draft whose save
 * is in flight stays as it is, because the editor is saving.
 *
 * @param names the editor's current names; left out, the session starts or
 *   stays as it is.
 */
function editTags(
  core: CoreState,
  annotationKey: string,
  names?: readonly string[],
): TagDraft | null {
  const standing = tagDraftFor(core, annotationKey);
  if (standing?.state.kind === "pending") return standing;
  const source = demandedSource(core);
  const held = standing ? null : holding(core, annotationKey);
  if (!standing && (!source || !held)) return null;
  const attachmentKey = standing?.attachmentKey ?? held!.attachmentKey;
  const capability = capabilityFor(core, attachmentKey);
  // While editing is unavailable no session starts, but a standing one
  // still takes its editor's last names: the editor closing as editing goes
  // adds the text still typed, which the held draft keeps for Save tags.
  const refused =
    capability.kind !== "writable" ||
    !!lockRefusal(core, annotationKey, "tags");
  if (refused && (!standing || names === undefined)) return standing;
  const draft: TagDraft = standing
    ? {
        ...standing,
        held: false,
        ...(names !== undefined && {
          names,
          state: { kind: "editing" } as const,
        }),
      }
    : {
        annotationKey,
        attachmentKey,
        serverID: source!.serverID,
        baseline: held!.record.tags,
        names: names ?? held!.record.tags,
        state: { kind: "editing" },
      };
  setDraft(core, "tags", draft);
  return draft;
}

/**
 * Save one tag editing session: one write that applies the session's added
 * and removed names to the tags Zotero holds now. A session that changed
 * nothing ends with no write. The draft stays, `pending`, until the
 * Annotation is read back, and then goes, so the editor closes onto the
 * confirmed tags.
 *
 * A draft that is not saved — held for Save tags, blocked, or failed — is
 * marked `held`, since its editor has closed.
 *
 * @param options.automatic whether the editor closing asks, rather than
 *   Save tags. A draft that needs Save tags — editing unavailable, or a
 *   failed save — is then held, unsaved.
 * @see apps/obsidian/docs/adr/0063-annotation-tags-save-once-per-editing-session-and-merge-by-name.md
 */
async function submitTags(
  core: CoreState,
  annotationKey: string,
  { automatic = false }: { automatic?: boolean } = {},
): Promise<MutationState> {
  const draft = tagDraftFor(core, annotationKey);
  if (!draft) return IDLE;
  if (draft.state.kind === "pending") return mutationFor(core, annotationKey);
  const change = tagChange(draft.baseline, draft.names);
  if (noTagChange(change)) {
    dropDraft(core, "tags", draft);
    return IDLE;
  }
  if (automatic && !canAutosave(core, draft)) {
    logger.debug("A tag draft is held for Save tags", {
      annotationKey,
      state: draft.state.kind,
      capability: capabilityFor(core, draft.attachmentKey).kind,
    });
    setDraft(core, "tags", { ...draft, manualSave: true, held: true });
    return IDLE;
  }
  const blocked =
    writeBlocked(core, draft.attachmentKey) ??
    lockRefusal(core, annotationKey, "tags");
  if (blocked) {
    setDraft(core, "tags", {
      ...draft,
      manualSave: true,
      held: true,
      state: { kind: "failed", failure: blocked },
    });
    return { kind: "failed", failure: blocked };
  }
  setDraft(core, "tags", { ...draft, state: { kind: "pending" } });
  logger.debug("A tag editing session is saved", {
    annotationKey,
    added: change.added.length,
    removed: change.removed.length,
  });
  const outcome = await command(core, annotationKey, {
    write: "tags",
    session: true,
    request: (target, record) =>
      tagsPatch(target, mergeTags(annotationTags(record), change)),
    propose: (record) =>
      proposedTags(mergeTags(annotationTags(record), change)),
  });
  const current = core.drafts.tags.get(
    indexedID(draft.serverID, annotationKey),
  );
  if (!current) return outcome;
  if (outcome.kind === "failed") {
    setDraft(core, "tags", {
      ...current,
      manualSave: true,
      held: true,
      state: outcome,
    });
  } else {
    dropDraft(core, "tags", current);
  }
  return outcome;
}

/** Drop a held tag draft and keep the tags Zotero holds. */
function discardTagDraft(core: CoreState, annotationKey: string): void {
  const draft = tagDraftFor(core, annotationKey);
  if (draft && draft.state.kind !== "pending") dropDraft(core, "tags", draft);
}

/**
 * Open this Attachment's Annotation History, from one PDF view bound to it.
 * Every surface that writes through this repository records into the history
 * the Attachment already holds, so a second view of the same Attachment joins
 * this one rather than starting its own.
 *
 * @param attachmentKey the Attachment's Indexed Key.
 */
function openHistory(core: CoreState, attachmentKey: string): void {
  const standing = core.histories.get(attachmentKey);
  if (standing) {
    standing.hold();
    return;
  }
  core.histories.set(attachmentKey, new AnnotationHistory());
  logger.debug("An annotation history opened", { attachmentKey });
  core.publish({ _tag: "history-changed", attachmentKey });
}

/**
 * Give up one PDF view's hold on this Attachment's Annotation History. The
 * last view to close ends the history, so an old session can never revert
 * today's work.
 *
 * @param attachmentKey the Attachment's Indexed Key.
 */
function closeHistory(core: CoreState, attachmentKey: string): void {
  const standing = core.histories.get(attachmentKey);
  if (!standing || standing.release() > 0) return;
  core.histories.delete(attachmentKey);
  logger.debug("An annotation history closed", { attachmentKey });
  core.publish({ _tag: "history-changed", attachmentKey });
}

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
function canUndo(core: CoreState, attachmentKey: string): boolean {
  return stepStands(core, attachmentKey, "undo");
}

/** Whether this Attachment's Annotation History holds a step to redo. */
function canRedo(core: CoreState, attachmentKey: string): boolean {
  return stepStands(core, attachmentKey, "redo");
}

/**
 * Step one confirmed edit back: the platform undo key, and the palette's
 * "Undo annotation change".
 *
 * @param attachmentKey the Attachment's Indexed Key.
 */
async function undo(
  core: CoreState,
  attachmentKey: string,
): Promise<HistoryOutcome> {
  return await stepHistory(core, attachmentKey, "undo");
}

/** Step one undone edit forward again. */
async function redo(
  core: CoreState,
  attachmentKey: string,
): Promise<HistoryOutcome> {
  return await stepHistory(core, attachmentKey, "redo");
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
async function stepHistory(
  core: CoreState,
  attachmentKey: string,
  direction: HistoryDirection,
): Promise<HistoryOutcome> {
  const history = core.histories.get(attachmentKey);
  if (!history || core.steppingAttachments.has(attachmentKey))
    return { kind: "idle" };
  if (savePending(core, attachmentKey)) return { kind: "idle" };
  const step = history.peek(direction);
  if (!step || beingEdited(core, step)) return { kind: "idle" };
  // An undo is a write, so it needs the Editing Capability like any other,
  // and the existing notice says why it did not run.
  if (writeBlocked(core, attachmentKey)) return { kind: "blocked" };
  // A lock on an Annotation the step writes refuses it before it is taken,
  // so the step stays where it stands, and the press names the Lock Reason.
  const locked = firstHeldLockRefusal(
    core,
    step.changes.map(({ annotationKey }) => annotationKey),
    step.kind,
  );
  if (locked) return { kind: "locked", reason: locked.failure.reason };

  core.steppingAttachments.add(attachmentKey);
  try {
    return await takeStep(core, step, { attachmentKey, direction, history });
  } finally {
    core.steppingAttachments.delete(attachmentKey);
    core.publish({ _tag: "history-changed", attachmentKey });
  }
}

/**
 * Whether a step stands in this direction that a press would actually take:
 * what {@link AnnotationRepository.canUndo} and
 * {@link AnnotationRepository.canRedo} answer, and what every surface that
 * draws a verb reads.
 */
function stepStands(
  core: CoreState,
  attachmentKey: string,
  direction: HistoryDirection,
): boolean {
  const step = core.histories.get(attachmentKey)?.peek(direction);
  return !!step && !beingEdited(core, step);
}

/**
 * Whether an Annotation Draft stands on an Annotation this step changes: a
 * comment draft, or a tag draft, whether its editor is open or it is held
 * for Save tags with no editor. A draft is a session Zotero does not hold
 * yet. An open comment editor answers these keys with its own text undo,
 * and a tag draft ends by its save or its discard before a step is taken.
 */
function beingEdited(core: CoreState, step: HistoryStep): boolean {
  return step.changes.some(({ annotationKey }) =>
    DRAFT_FIELDS.some((field) => draftFor(core, field, annotationKey)),
  );
}

/**
 * The field check and the write of one step. Every Annotation the step names
 * is compared before any of them is written, so a step that cannot be taken
 * whole is taken not at all.
 */
async function takeStep(
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
): Promise<HistoryOutcome> {
  if (step.kind === "existence") {
    return await takeExistenceStep(core, step, {
      attachmentKey,
      direction,
      history,
    });
  }
  if (step.kind === "tags") {
    return await takeTagStep(core, step, {
      attachmentKey,
      direction,
      history,
    });
  }
  const checked: { change: HistoryChange; record: AnnotationRecord }[] = [];
  for (const change of step.changes) {
    const record = holding(core, change.annotationKey)?.record;
    if (record && stillHolds(change.after, record)) {
      checked.push({ change, record });
      continue;
    }
    logger.debug("A history step was dropped: Zotero holds another value", {
      attachmentKey,
      annotationKey: change.annotationKey,
      kind: step.kind,
      missing: !record,
    });
    history.drop(direction, step);
    return { kind: "changed", annotationKey: change.annotationKey };
  }

  const left: HistoryChange[] = [];
  for (const { change, record } of checked) {
    const { annotationKey } = change;
    // The record the write is sent against is the far step's `before`, built
    // the way every step's is.
    const before = historyFieldsOf(step.kind, record) ?? change.after;
    let outcome = await stepWrite(core, annotationKey, change.before);
    if (
      outcome.kind === "conflict" &&
      stillHeldAfterConflict(change.after, outcome.conflict)
    ) {
      // The `412` re-read the Annotation and it still holds what the step
      // left there, so only the version moved: send the write once more.
      outcome = await stepWrite(core, annotationKey, change.before);
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
      discardConflict(core, annotationKey);
      history.drop(direction, step);
      return { kind: "changed", annotationKey };
    }
    const settled = holding(core, annotationKey)?.record;
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
}

/**
 * Write one side of a History Step through the repository's own verbs, so a
 * step carries the same version stamping, capability gate, conflict handling,
 * and failure path as the edit it steps back. The Annotation is named as the
 * step's own while the write is away, so what it confirms records no step.
 */
async function stepWrite(
  core: CoreState,
  annotationKey: string,
  fields: HistoryFields,
): Promise<MutationState> {
  core.steppingWrites.add(annotationKey);
  try {
    if (fields.color !== undefined) {
      return await patchColor(core, annotationKey, fields.color);
    }
    for (const field of TEXT_FIELDS) {
      const value = fields[field];
      if (value !== undefined) {
        return await writeText(core, field, annotationKey, { value });
      }
    }
    if (fields.geometry !== undefined) {
      // A step's own write joins nothing: the step it leaves behind is
      // already the one that steps it back.
      return await patchGeometry(
        core,
        annotationKey,
        fields.geometry,
        "pointer",
      );
    }
    return IDLE;
  } finally {
    core.steppingWrites.delete(annotationKey);
  }
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
async function takeTagStep(
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
): Promise<HistoryOutcome> {
  const [{ annotationKey, tags }] = step.changes;
  const record = holding(core, annotationKey)?.record;
  if (!record) {
    logger.debug("A history step was dropped: Zotero no longer holds it", {
      attachmentKey,
      annotationKey,
      kind: step.kind,
    });
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
    logger.debug("A tag step had nothing to write: Zotero holds its names", {
      attachmentKey,
      annotationKey,
    });
    history.drop(direction, step);
    return { kind: "stepped", annotationKey };
  }

  let sent = record;
  core.steppingWrites.add(annotationKey);
  let outcome: MutationState;
  try {
    outcome = await command(core, annotationKey, {
      write: "tags",
      request: (target, against) => {
        sent = against;
        return tagsPatch(target, mergeTags(annotationTags(against), reverse));
      },
      propose: (against) =>
        proposedTags(mergeTags(annotationTags(against), reverse)),
    });
  } finally {
    core.steppingWrites.delete(annotationKey);
  }
  history.drop(direction, step);
  if (outcome.kind === "failed") {
    return { kind: "failed", failure: outcome.failure };
  }
  const settled = holding(core, annotationKey)?.record;
  const left =
    settled && tagChange(annotationTags(sent), annotationTags(settled));
  if (left && !noTagChange(left)) {
    history.push(opposite(direction), {
      kind: step.kind,
      changes: [{ annotationKey, tags: left }],
    });
  }
  return { kind: "stepped", annotationKey };
}

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
async function takeExistenceStep(
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
): Promise<HistoryOutcome> {
  for (const change of step.changes) {
    const record = holding(core, change.annotationKey)?.record ?? null;
    if (sameContent(change.after.content ?? null, record)) continue;
    logger.debug("A history step was dropped: Zotero holds another value", {
      attachmentKey,
      annotationKey: change.annotationKey,
      kind: step.kind,
      missing: !record,
    });
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
      const erased = await deleteAnnotation(core, change.annotationKey);
      if (erased.kind === "failed") {
        return { kind: "failed", failure: erased.failure };
      }
      if (erased.kind !== "idle") {
        discardConflict(core, change.annotationKey);
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
    const made = await createAnnotation(core, attachmentKey, wanted);
    if (made.kind === "failed") {
      return { kind: "failed", failure: made.failure };
    }
    // Zotero named the restored Annotation itself, so every step of both
    // stacks that asked after the old key asks after this one now.
    history.rename(change.annotationKey, made.annotationKey);
    const settled = holding(core, made.annotationKey)?.record ?? null;
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
  logger.debug("An existence step was taken", {
    attachmentKey,
    direction,
    restored: step.changes.filter(isRestore).length,
    restoredAsCreator: count,
  });
  return {
    kind: "stepped",
    annotationKey: left[0]!.annotationKey,
    ...(count > 0 && { restoredAsCreator: { count } }),
  };
}

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
      const save = core.textSaves[field].get(
        indexedID(draft.serverID, draft.annotationKey),
      );
      if (!save) continue;
      if (save.idleTimer !== null || save.burstTimer !== null) return true;
    }
  }
  return false;
}

function canAutosave(
  core: CoreState,
  draft: Pick<TextFieldDraft, "attachmentKey" | "manualSave">,
): boolean {
  const capability = capabilityFor(core, draft.attachmentKey);
  return !draft.manualSave && capability.kind === "writable";
}

function scheduleTextSave(
  core: CoreState,
  field: TextField,
  draft: TextFieldDraft,
): void {
  const save = textSave(
    core,
    field,
    indexedID(draft.serverID, draft.annotationKey),
  );
  // Text typed behind a save in flight is sent once that save lands.
  if (savingText(core, field, draft.annotationKey)) return;
  if (!canAutosave(core, draft)) return;
  if (sameText(draft.text, draft.baseline)) return;
  if (save.idleTimer !== null) window.clearTimeout(save.idleTimer);
  save.idleTimer = window.setTimeout(() => {
    save.idleTimer = null;
    void submitTextField(core, field, draft.annotationKey, {
      automatic: true,
    });
  }, TEXT_IDLE_SAVE_MS);
  save.burstTimer ??= window.setTimeout(() => {
    save.burstTimer = null;
    void submitTextField(core, field, draft.annotationKey, {
      automatic: true,
    });
  }, TEXT_BURST_SAVE_MS);
}
