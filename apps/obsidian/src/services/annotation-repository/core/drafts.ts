// Draft editing and autosave: the comment, Quoted Text and tag drafts a surface edits, and how they are saved.
import { Duration, Effect, FiberMap, FiberSet } from "effect";

import { recover } from "@/lib/effect-cause";
import {
  annotationTags,
  byTextField,
  IDLE,
  mergeTags,
  noTagChange,
  tagChange,
  tagsPatch,
  TEXT_FIELDS,
} from "@/services/annotation-repository/write";
import type {
  MutationState,
  TextField,
} from "@/services/annotation-repository/write";

import {
  cancelTextSave,
  draftFor,
  draftsOn,
  dropDraft,
  saveKey,
  setDraft,
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
import type { WriteRunFailed } from "./writes";

const TEXT_IDLE_SAVE = Duration.seconds(1);

const TEXT_BURST_SAVE = Duration.seconds(10);

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
const annotationState = Effect.fnUntraced(function* (
  core: CoreState,
  annotationKey: string,
): Effect.fn.Return<AnnotationState> {
  const textDrafts = yield* Effect.all(
    byTextField((field) => draftFor(core, field, annotationKey)),
  );
  const tagDraft = yield* tagDraftFor(core, annotationKey);
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
});

/**
 * The active Zotero database's shared draft of one text field of an
 * Annotation: its comment or its Quoted Text.
 */
function textDraftFor(
  core: CoreState,
  field: TextField,
  annotationKey: string,
): Effect.Effect<TextFieldDraft | null> {
  return draftFor(core, field, annotationKey);
}

/**
 * Start or update one shared text field draft: a comment edit, or a Text
 * Edit on the Quoted Text. Without `text`, the draft starts from the
 * confirmed value, or stays as it stands.
 *
 * @returns the draft, or `null` where none can start.
 */
const editTextField = Effect.fnUntraced(function* (
  core: CoreState,
  field: TextField,
  { annotationKey, text }: { annotationKey: string; text?: string },
): Effect.fn.Return<TextFieldDraft | null> {
  const source = yield* core.localApi.demandSource;
  const standing = yield* draftFor(core, field, annotationKey);
  const held = standing ? null : yield* holding(core, annotationKey);
  if (!standing && (!source || !held)) return null;
  const capability = yield* capabilityFor(
    core,
    standing?.attachmentKey ?? held!.attachmentKey,
  );
  if (capability.kind !== "writable") return standing ?? null;
  // A lock takes no keystroke either: a draft already standing is held.
  if (yield* lockRefusal(core, annotationKey, field)) return standing ?? null;
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
    yield* scheduleTextSave(core, field, draft);
  }
  return draft;
});

/** Submit one text field's current shared draft once. */
const submitTextField = Effect.fnUntraced(function* (
  core: CoreState,
  field: TextField,
  {
    annotationKey,
    automatic = false,
  }: { annotationKey: string; automatic?: boolean },
): Effect.fn.Return<MutationState, WriteRunFailed> {
  const draft = yield* draftFor(core, field, annotationKey);
  if (!draft) return IDLE;
  yield* cancelTextSave(core, field, draft);
  if (draft.state.kind === "conflict") {
    return mutationFor(core, annotationKey);
  }
  const saving = savingText(core, field, annotationKey);
  // A draft holding what Zotero already has is not a draft: it is dropped
  // ahead of every other answer, so an editor the user opened and closed
  // without typing leaves nothing behind for a card to announce. Manual-save
  // mode does not hold it either — there is nothing there to save.
  if (!saving && sameText(draft.text, draft.baseline)) {
    yield* dropDraft(core, field, draft);
    return IDLE;
  }
  // Text a save already carries needs no second one.
  if (saving && sameText(proposedText(field, saving), draft.text)) {
    return yield* answerOf(core, saving);
  }
  // Text typed while a save is in flight queues behind it, even behind the
  // Save comment pressed on a held draft, which that save's success ends.
  if (!saving) {
    if (automatic && !(yield* canAutosave(core, draft))) return IDLE;
    const capability = yield* capabilityFor(core, draft.attachmentKey);
    if (capability.kind !== "writable")
      return {
        kind: "failed",
        failure: (yield* writeBlocked(core, draft.attachmentKey))!,
      };
  }
  // A lock refuses the draft before it turns pending, queued or not.
  const locked = yield* lockRefusal(core, annotationKey, field);
  if (locked) return { kind: "failed", failure: locked };
  const submittedText = draft.text;
  setDraft(core, field, { ...draft, state: { kind: "pending" } });
  return yield* sendText(core, field, { draft, submittedText, automatic });
});

const sendText = Effect.fnUntraced(function* (
  core: CoreState,
  field: TextField,
  {
    draft: { annotationKey, serverID },
    submittedText,
    automatic,
  }: { draft: TextFieldDraft; submittedText: string; automatic: boolean },
) {
  const id = indexedID(serverID, annotationKey);
  return yield* writeText(core, annotationKey, {
    field,
    value: submittedText,
    // The draft takes the save's outcome before the next write on the
    // Annotation starts, so a save queued behind a failed one is held.
    run: (send, own) =>
      Effect.gen(function* () {
        if (
          yield* textSuperseded(core, field, {
            own,
            annotationKey,
            id,
            automatic,
          })
        ) {
          yield* Effect.logDebug("A queued text save stood down").pipe(
            Effect.annotateLogs({ annotationKey, field }),
          );
          return { kind: "pending", write: field } satisfies MutationState;
        }
        const outcome = yield* send;
        const current = core.drafts[field].get(id);
        if (current && current.state.kind !== "conflict") {
          yield* applyTextWriteDecision(core, field, {
            annotationKey,
            current,
            submittedText,
            outcome,
            own,
          });
        }
        return outcome;
      }),
  });
});

/**
 * Whether a text save that waited its turn is no longer needed: a later
 * save of the same field or a delete on the same Annotation replaces it, or
 * its draft ended, met a conflict, or was held by a failed save while it
 * waited. An automatic save also stands down where autosave is off.
 */
const textSuperseded = Effect.fnUntraced(function* (
  core: CoreState,
  field: TextField,
  {
    own,
    annotationKey,
    id,
    automatic,
  }: {
    own: AnnotationMutation;
    annotationKey: string;
    id: string;
    automatic: boolean;
  },
) {
  const current = core.drafts[field].get(id);
  if (
    !current ||
    current.state.kind === "conflict" ||
    current.state.kind === "failed" ||
    (automatic && !(yield* canAutosave(core, current)))
  ) {
    return true;
  }
  const writes = pendingWrites(core, annotationKey);
  return writes.slice(writes.indexOf(own) + 1).some(({ options }) => {
    const write = options.mutationKey?.[2];
    return write === field || write === "delete";
  });
});

/** Keep Zotero's reviewed value of one text field and discard the draft. */
const discardTextDraft = Effect.fnUntraced(function* (
  core: CoreState,
  field: TextField,
  annotationKey: string,
) {
  const draft = yield* draftFor(core, field, annotationKey);
  if (draft) yield* dropDraft(core, field, draft);
  if (core.outcomes.get(annotationKey)?.get(field)?.kind === "conflict") {
    settle(core, annotationKey, { write: field, state: IDLE });
  }
});

/** Apply one text field's shared draft again against the reviewed fresh record. */
const retryTextDraft = Effect.fnUntraced(function* (
  core: CoreState,
  field: TextField,
  annotationKey: string,
): Effect.fn.Return<MutationState, WriteRunFailed> {
  const draft = yield* draftFor(core, field, annotationKey);
  if (!draft) return IDLE;
  yield* cancelTextSave(core, field, draft);
  const saving = savingText(core, field, annotationKey);
  if (saving) return yield* answerOf(core, saving);
  // The draft and its Write Conflict stay as they stand.
  const locked = yield* lockRefusal(core, annotationKey, field);
  if (locked) return { kind: "failed", failure: locked };
  return yield* resendText(core, field, draft);
});

const resendText = Effect.fnUntraced(function* (
  core: CoreState,
  field: TextField,
  draft: TextFieldDraft,
) {
  const { annotationKey } = draft;
  const held = yield* holding(core, annotationKey);
  const reviewed =
    draft.state.kind === "conflict" ? draft.state.fresh : draft.baseline;
  const fresh = (held && TEXT_FIELD_SPECS[field].valueOf(held.record)) ?? "";
  if (!held || !sameText(fresh, reviewed)) {
    const outcome: MutationState = {
      kind: "conflict",
      conflict: { write: field, attempted: draft.text, fresh },
    };
    settle(core, annotationKey, { write: field, state: outcome });
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
  const resend = writeText(core, annotationKey, {
    field,
    value: submittedText,
  });
  let outcome = yield* resend;
  if (
    outcome.kind === "conflict" &&
    outcome.conflict.write === field &&
    sameText(outcome.conflict.fresh, reviewed)
  ) {
    outcome = yield* resend;
  }
  const current = core.drafts[field].get(id);
  if (!current) return outcome;
  yield* applyTextWriteDecision(core, field, {
    annotationKey,
    current,
    submittedText,
    outcome,
  });
  return outcome;
});

const applyTextWriteDecision = Effect.fnUntraced(function* (
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
) {
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
    yield* dropDraft(core, field, current);
  } else if (decision.kind === "update") {
    core.drafts[field].set(
      indexedID(current.serverID, annotationKey),
      decision.draft,
    );
    core.publish({ _tag: "annotation-changed", annotationKey });
    // Text typed while the save was away, even behind a Save comment
    // pressed on a held draft, whose success ends the hold, is sent now.
    if (outcome.kind === "idle" && decision.draft.state.kind === "editing") {
      yield* autosave(core, field, annotationKey);
    }
  }
});

/** The active Zotero database's shared tag draft for one Annotation. */
function tagDraftFor(
  core: CoreState,
  annotationKey: string,
): Effect.Effect<TagDraft | null> {
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
const editTags = Effect.fnUntraced(function* (
  core: CoreState,
  annotationKey: string,
  names?: readonly string[],
): Effect.fn.Return<TagDraft | null> {
  const standing = yield* tagDraftFor(core, annotationKey);
  if (standing?.state.kind === "pending") return standing;
  const source = yield* core.localApi.demandSource;
  const held = standing ? null : yield* holding(core, annotationKey);
  if (!standing && (!source || !held)) return null;
  const attachmentKey = standing?.attachmentKey ?? held!.attachmentKey;
  const capability = yield* capabilityFor(core, attachmentKey);
  // While editing is unavailable no session starts, but a standing one
  // still takes its editor's last names: the editor closing as editing goes
  // adds the text still typed, which the held draft keeps for Save tags.
  const refused =
    capability.kind !== "writable" ||
    !!(yield* lockRefusal(core, annotationKey, "tags"));
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
});

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
const submitTags = Effect.fnUntraced(function* (
  core: CoreState,
  annotationKey: string,
  { automatic = false }: { automatic?: boolean } = {},
): Effect.fn.Return<MutationState, WriteRunFailed> {
  const draft = yield* tagDraftFor(core, annotationKey);
  if (!draft) return IDLE;
  if (draft.state.kind === "pending") return mutationFor(core, annotationKey);
  const change = tagChange(draft.baseline, draft.names);
  if (noTagChange(change)) {
    yield* dropDraft(core, "tags", draft);
    return IDLE;
  }
  if (automatic && !(yield* canAutosave(core, draft))) {
    const capability = yield* capabilityFor(core, draft.attachmentKey);
    yield* Effect.logDebug("A tag draft is held for Save tags").pipe(
      Effect.annotateLogs({
        annotationKey,
        state: draft.state.kind,
        capability: capability.kind,
      }),
    );
    setDraft(core, "tags", { ...draft, manualSave: true, held: true });
    return IDLE;
  }
  const blocked =
    (yield* writeBlocked(core, draft.attachmentKey)) ??
    (yield* lockRefusal(core, annotationKey, "tags"));
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
  yield* Effect.logDebug("A tag editing session is saved").pipe(
    Effect.annotateLogs({
      annotationKey,
      added: change.added.length,
      removed: change.removed.length,
    }),
  );
  const outcome = yield* command(core, annotationKey, {
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
    yield* dropDraft(core, "tags", current);
  }
  return outcome;
});

/** Drop a held tag draft and keep the tags Zotero holds. */
const discardTagDraft = Effect.fnUntraced(function* (
  core: CoreState,
  annotationKey: string,
) {
  const draft = yield* tagDraftFor(core, annotationKey);
  if (draft && draft.state.kind !== "pending")
    yield* dropDraft(core, "tags", draft);
});

const canAutosave = Effect.fnUntraced(function* (
  core: CoreState,
  draft: Pick<TextFieldDraft, "attachmentKey" | "manualSave">,
) {
  const capability = yield* capabilityFor(core, draft.attachmentKey);
  return !draft.manualSave && capability.kind === "writable";
});

/**
 * An automatic save that no caller waits on. It runs on the layer's
 * FiberSet, so the layer's close stops it, and a failure is logged.
 */
function autosave(core: CoreState, field: TextField, annotationKey: string) {
  return FiberSet.run(
    core.fibers,
    submitTextField(core, field, { annotationKey, automatic: true }).pipe(
      recover(
        (cause) =>
          Effect.logWarning("An automatic text save failed", cause).pipe(
            Effect.annotateLogs({ annotationKey, field }),
          ),
        Effect.void,
      ),
    ),
  );
}

/**
 * Arm a draft's autosave: the idle timer starts again with each keystroke,
 * and the burst timer runs from the first keystroke of a run of typing. A
 * timer that comes due leaves its map and starts the save on the layer's
 * FiberSet, so the save outlives the timer.
 */
const scheduleTextSave = Effect.fnUntraced(function* (
  core: CoreState,
  field: TextField,
  draft: TextFieldDraft,
) {
  // Text typed behind a save in flight is sent once that save lands.
  if (savingText(core, field, draft.annotationKey)) return;
  if (!(yield* canAutosave(core, draft))) return;
  if (sameText(draft.text, draft.baseline)) return;
  const key = saveKey(field, draft);
  const save = autosave(core, field, draft.annotationKey);
  yield* FiberMap.run(
    core.idleSaves,
    key,
    Effect.andThen(Effect.sleep(TEXT_IDLE_SAVE), save),
  );
  yield* FiberMap.run(
    core.burstSaves,
    key,
    Effect.andThen(Effect.sleep(TEXT_BURST_SAVE), save),
    { onlyIfMissing: true },
  );
});

/**
 * Hold every draft that Zotero no longer lets ZotLit save, after the Editing
 * Capability changed: a text draft stops its autosave, and each held draft
 * waits for an explicit save.
 */
const holdUnsavableDrafts = Effect.fnUntraced(function* (core: CoreState) {
  for (const field of TEXT_FIELDS) {
    const drafts = core.drafts[field];
    for (const [id, draft] of drafts) {
      if ((yield* capabilityFor(core, draft.attachmentKey)).kind === "writable")
        continue;
      yield* cancelTextSave(core, field, draft);
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
      (yield* capabilityFor(core, draft.attachmentKey)).kind === "writable"
    )
      continue;
    setDraft(core, "tags", { ...draft, manualSave: true });
  }
  core.publish({ _tag: "capability-changed" });
});

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
  holdUnsavableDrafts,
};
