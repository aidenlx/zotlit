// Draft editing and autosave: the comment, Quoted Text and tag drafts a surface edits, and how they are saved.
import { getLogger } from "@/lib/log";
import {
  annotationTags,
  byTextField,
  IDLE,
  mergeTags,
  noTagChange,
  tagChange,
  tagsPatch,
} from "@/services/annotation-repository/write";
import type {
  MutationState,
  TextField,
} from "@/services/annotation-repository/write";

import { demandedSource } from "./bridge";
import {
  clearTextTimers,
  draftFor,
  draftsOn,
  dropDraft,
  setDraft,
  textSave,
} from "./draft-store";
import { capabilityFor, holding } from "./lists";
import {
  TEXT_FIELD_SPECS,
  indexedID,
  proposedTags,
  proposedText,
  sameText,
} from "./model";
import type {
  AnnotationMutation,
  AnnotationState,
  TagDraft,
  TextFieldDraft,
} from "./model";
import {
  answerOf,
  mutationFor,
  pendingWrites,
  savingText,
  settle,
} from "./outcomes";
import type { CoreState } from "./state";
import { command, lockRefusal, writeBlocked, writeText } from "./writes";

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
  const source = core.bridge.runSync(demandedSource(core));
  const standing = draftFor(core, field, annotationKey);
  const held = standing
    ? null
    : core.bridge.runSync(holding(core, annotationKey));
  if (!standing && (!source || !held)) return null;
  const capability = core.bridge.runSync(
    capabilityFor(core, standing?.attachmentKey ?? held!.attachmentKey),
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
    const capability = core.bridge.runSync(
      capabilityFor(core, draft.attachmentKey),
    );
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
  const held = core.bridge.runSync(holding(core, annotationKey));
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
  const source = core.bridge.runSync(demandedSource(core));
  const held = standing
    ? null
    : core.bridge.runSync(holding(core, annotationKey));
  if (!standing && (!source || !held)) return null;
  const attachmentKey = standing?.attachmentKey ?? held!.attachmentKey;
  const capability = core.bridge.runSync(capabilityFor(core, attachmentKey));
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
      capability: core.bridge.runSync(capabilityFor(core, draft.attachmentKey))
        .kind,
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

function canAutosave(
  core: CoreState,
  draft: Pick<TextFieldDraft, "attachmentKey" | "manualSave">,
): boolean {
  const capability = core.bridge.runSync(
    capabilityFor(core, draft.attachmentKey),
  );
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

export {
  annotationState,
  textDraftFor,
  editTextField,
  submitTextField,
  discardTextDraft,
  retryTextDraft,
  tagDraftFor,
  editTags,
  submitTags,
  discardTagDraft,
};
