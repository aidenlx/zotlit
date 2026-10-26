// Writes and conflicts: every command to Zotero, run one at a time per Annotation, and what its answer leaves behind.
import {
  Cause,
  DateTime,
  Effect,
  Exit,
  Fiber,
  FiberSet,
  Option,
  Result,
  Schema,
} from "effect";

import { parseAnnotationPosition, parseIndexedKey } from "@zotlit/db";
import type { AnnotationPositionRaw } from "@zotlit/db";

import { valueOr } from "@/lib/effect-bridge";
import { recover } from "@/lib/effect-cause";
import { fromInstant, toInstant } from "@/lib/effect-clock";
import { contentOf } from "@/services/annotation-repository/history";
import type {
  HistoryJoin,
  HistoryStep,
} from "@/services/annotation-repository/history";
import { lockRefuses } from "@/services/annotation-repository/lock";
import type {
  AnnotationLock,
  LockedVerb,
  LockReason,
} from "@/services/annotation-repository/lock";
import {
  resolvesSilently,
  sameStoredGeometry,
} from "@/services/annotation-repository/reconcile";
import {
  colorPatch,
  createRequest,
  eraseRequest,
  geometryPatch,
  IDLE,
  MAX_POSITION_LENGTH,
  TEXT_FIELDS,
  wireColor,
  writePosition,
} from "@/services/annotation-repository/write";
import type {
  AnnotationDraft,
  ConflictedWrite,
  GeometryEdit,
  GeometryInput,
  MutationState,
  TextField,
  WriteConflict,
  WriteFailure,
  WriteRequest,
  WriteTarget,
} from "@/services/annotation-repository/write";
import type {
  LocalApiFailure,
  LocalApiSource,
} from "@/services/zotero-local-api/service";
import {
  libraryPath,
  readCreateResult,
} from "@/services/zotero-local-api/wire";

import { demandedSource, invalidate } from "./bridge";
import type { DatabaseRowsError } from "./bridge";
import {
  cancelTextSave,
  draftFor,
  dropDrafts,
  reconcileDrafts,
} from "./draft-store";
import { recordExistence, recordGroup, recordStep } from "./history-record";
import {
  announceReadPixels,
  attachmentHolding,
  compatibleApiSource,
  dropAttachment,
  editingCapability,
  holding,
  prepareCollection,
  prepareWrite,
  read,
  refresh,
  rememberAcknowledgedRevision,
  sourceStillBound,
} from "./lists";
import type { AnnotationLibraryUnresolved } from "./lists";
import {
  ANNOTATIONS,
  TEXT_FIELD_SPECS,
  freshValueOf,
  fromLocalApi,
} from "./model";
import type {
  AnnotationConfirmation,
  AnnotationMutation,
  AnnotationRecord,
  ConfirmedWrite,
  GroupKind,
  GroupWrites,
  HeldAnnotation,
  PendingProposal,
  ProposedFields,
  WriteAttempt,
} from "./model";
import { leave, settle, standingOutcome, takeOver } from "./outcomes";
import type { CoreState } from "./state";

/** The write failure a lock gives, with its Lock Reason. */
type LockedFailure = Extract<WriteFailure, { kind: "locked" }>;

/**
 * Why a write's run answered no outcome: a read under it failed, or it threw.
 * Its `cause` is a `WriteReadError` or a defect from the run.
 */
export class WriteRunFailed extends Schema.TaggedError<
  WriteRunFailed,
  { readonly brand: unique symbol }
>()("WriteRunFailed", { cause: Schema.Defect() }) {}

/**
 * What a write answers when the repository closed under it: Zotero may or
 * may not have taken it.
 */
const UNKNOWN_OUTCOME: MutationState = {
  kind: "failed",
  failure: { kind: "unknown-outcome" },
};

/** One write on the query client's mutation cache; its variables are its proposal. */
/**
 * What a write does once its turn comes, given the send itself: it can resolve
 * as still pending with nothing sent, or act on its outcome before the next
 * write on the Annotation starts.
 */
type WriteTurn = (
  send: () => Promise<MutationState>,
  own: AnnotationMutation,
) => Promise<MutationState>;

/** One command, as {@link command} takes it. */
type Command = WriteAttempt & {
  request: (target: WriteTarget, record: AnnotationRecord) => WriteRequest;
  settle?: "re-read" | "drop";
  join?: HistoryJoin;
  /** The fields the write proposes, from the confirmed record it goes to. */
  propose?: (record: AnnotationRecord) => ProposedFields;
  run?: WriteTurn;
  gather?: GroupWrites;
};

/** One command once it is queued, as {@link runCommand} sends it. */
type QueuedCommand = WriteAttempt & {
  expectedServerID: string | null;
  generation: number;
  request: (target: WriteTarget, record: AnnotationRecord) => WriteRequest;
  settle?: "re-read" | "drop";
  join?: HistoryJoin;
  /**
   * Where a write of a group puts what it landed; the group records one
   * step for all of them once every write settles.
   */
  gather?: GroupWrites;
  /** Set on the second send of a tag write, after its `412` re-read. */
  reapplied?: true;
  /**
   * What Zotero answered the send, or `null` while no answer is read. A close
   * of the layer after the answer interrupts only the reads that follow, so
   * the write keeps it. Read only by the `mutationFn` edge.
   */
  progress?: { answer: MutationState | null };
};

/** Why a write's reads failed under it. */
type WriteReadError = DatabaseRowsError | AnnotationLibraryUnresolved;

/** What one create ended with. */
export type CreateOutcome =
  /** @param annotationKey the Indexed Key Zotero generated. */
  | { kind: "created"; annotationKey: string }
  | { kind: "failed"; failure: WriteFailure };

/**
 * Create one highlight or underline on an Attachment, from a user gesture.
 *
 * An explicit authorization must already be available. The write is a
 * one-element multi-object `POST` carrying
 * a write token and no client key, and its answer is checked object by object
 * before the created Annotation is read back.
 *
 * The Attachment's list is dropped rather than patched, because the list is
 * kept in Zotero's own reading order and only a fresh read can place a new
 * Annotation in it.
 *
 * @param attachmentKey the Attachment's Indexed Key.
 * @param create.draft everything about the Annotation except its parent,
 *   which this Attachment names; its Sort Index was computed from the
 *   unrounded position.
 * @param create.group what joins this create to the others of one gesture in
 *   the Annotation History — one ink stroke split at the position ceiling
 *   creates several Annotations and is still one History Step. A create that
 *   names none is a step of its own.
 * @see apps/obsidian/docs/adr/0038-write-authorization-starts-only-from-a-user-gesture.md
 */
const createAnnotation = Effect.fnUntraced(function* (
  core: CoreState,
  attachmentKey: string,
  create: { draft: Omit<AnnotationDraft, "parentKey">; group?: string },
): Effect.fn.Return<CreateOutcome, WriteReadError> {
  // The create runs on the layer's Scope, as a command does. A close of the
  // layer interrupts it: before Zotero answered the send, its outcome is
  // unknown; after, the create keeps that answer.
  const progress: { answer: CreateOutcome | null } = { answer: null };
  const fiber = yield* FiberSet.run(
    core.fibers,
    counted(
      core,
      attachmentKey,
      sendCreate(core, attachmentKey, { ...create, progress }),
    ),
  );
  const exit = yield* Fiber.await(fiber);
  if (Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)) {
    return (
      progress.answer ?? {
        kind: "failed",
        failure: { kind: "unknown-outcome" },
      }
    );
  }
  return yield* exit;
});

const sendCreate = Effect.fnUntraced(function* (
  core: CoreState,
  attachmentKey: string,
  {
    draft,
    group,
    progress,
  }: {
    draft: Omit<AnnotationDraft, "parentKey">;
    group?: string;
    /**
     * What Zotero answered the create, or `null` while no answer is read.
     * Read only by {@link createAnnotation}.
     */
    progress: { answer: CreateOutcome | null };
  },
): Effect.fn.Return<CreateOutcome, WriteReadError> {
  const parsed = parseIndexedKey(attachmentKey);
  if (!parsed) {
    return { kind: "failed", failure: { kind: "unknown-annotation" } };
  }
  const expectedSource = yield* compatibleApiSource(core, attachmentKey);
  if (!expectedSource) {
    return { kind: "failed", failure: { kind: "db-source" } };
  }
  if (!(yield* prepareCollection(core, attachmentKey, expectedSource))) {
    return { kind: "failed", failure: { kind: "server-changed" } };
  }
  const whole = { ...draft, parentKey: parsed.key };
  if (writePosition(whole.position).length > MAX_POSITION_LENGTH) {
    yield* Effect.logDebug(
      "A selection's position is longer than Zotero accepts",
    ).pipe(Effect.annotateLogs({ attachmentKey }));
    return { kind: "failed", failure: { kind: "position-too-large" } };
  }

  const blocked = yield* writeBlocked(core, attachmentKey);
  if (blocked) return { kind: "failed", failure: blocked };

  const library = libraryPath(parsed);
  const request = createRequest(library, whole, core.writeToken());
  const source = yield* compatibleApiSource(core, attachmentKey);
  const reply = yield* core.localApi.authorizedSend(request.path, {
    library,
    method: request.method,
    headers: request.headers,
    body: request.body,
  });
  const created =
    "failure" in reply
      ? reply
      : readCreateResult(reply.value.text, {
          parentKey: attachmentKey,
          type: whole.type,
        });
  progress.answer =
    "failure" in created
      ? { kind: "failed", failure: created.failure }
      : { kind: "created", annotationKey: created.value.key };
  if (!source || !(yield* sourceStillBound(core, attachmentKey, source))) {
    return { kind: "failed", failure: { kind: "server-changed" } };
  }
  if ("failure" in reply) {
    yield* Effect.logDebug("Zotero did not confirm an annotation create").pipe(
      Effect.annotateLogs({ attachmentKey, failure: reply.failure }),
    );
    yield* refresh(core, attachmentKey);
    return { kind: "failed", failure: reply.failure };
  }

  if ("failure" in created) {
    yield* refresh(core, attachmentKey);
    return { kind: "failed", failure: created.failure };
  }

  const annotationKey = created.value.key;
  rememberAcknowledgedRevision(core, attachmentKey, reply.value.headers);
  const record = fromLocalApi(created.value);
  if (
    !(yield* publishApiChange(
      core,
      { attachmentKey, source },
      { kind: "created", record },
    ))
  )
    return { kind: "failed", failure: { kind: "server-changed" } };
  yield* refresh(core, attachmentKey);
  yield* Effect.logDebug("Zotero created an annotation").pipe(
    Effect.annotateLogs({ attachmentKey, annotationKey, type: whole.type }),
  );
  const content = contentOf(record);
  if (content) {
    yield* recordExistence(
      core,
      { annotationKey, before: { content: null }, after: { content } },
      { attachmentKey, group },
    );
  }
  core.publish({ _tag: "annotations-changed", attachmentKey });
  return { kind: "created", annotationKey };
});

/**
 * Recolour one Annotation, of whatever type: Zotero's colour setter is one
 * rule for all six, so an ink stroke recolours like a highlight.
 *
 * @param annotationKey the Annotation's Indexed Key.
 * @param color the swatch to store, in any case; the write sends lower case.
 */
const patchColor = Effect.fnUntraced(function* (
  core: CoreState,
  annotationKey: string,
  color: string,
) {
  return yield* recolor(core, annotationKey, { color });
});

/**
 * Recolour a group of Annotations in Zotero, from one gesture on the Card
 * Selection. Each Annotation goes out as a request of its own and keeps its
 * own outcome, a Write Conflict included. The recolours that land are one
 * History Step, so one undo puts every colour back; a recolour that did not
 * land is not in it. A lock on one Annotation refuses the whole group, so
 * none goes out.
 *
 * @param annotationKeys Indexed Keys, in the order the step names them.
 * @param color the swatch to store, in any case; the write sends lower case.
 * @returns one outcome per key, in the order of `annotationKeys`.
 */
const patchColors = Effect.fnUntraced(function* (
  core: CoreState,
  annotationKeys: readonly string[],
  color: string,
) {
  return yield* groupWrite(
    core,
    { kind: "color", annotationKeys },
    (key, gather) => recolor(core, key, { color, gather }),
  );
});

/**
 * @param recolour.gather where a recolour of a group puts its landed write,
 *   rather than recording a step of its own.
 */
const recolor = Effect.fnUntraced(function* (
  core: CoreState,
  annotationKey: string,
  { color, gather }: { color: string; gather?: GroupWrites },
) {
  return yield* command(core, annotationKey, {
    write: "color",
    attempted: color,
    request: (target) => colorPatch(target, color),
    propose: () => ({ color: wireColor(color) }),
    ...(gather && { gather }),
  });
});

/**
 * Replace one Annotation's comment. An empty string clears it.
 *
 * @param annotationKey the Annotation's Indexed Key.
 */
const patchComment = Effect.fnUntraced(function* (
  core: CoreState,
  annotationKey: string,
  comment: string,
) {
  return yield* writeText(core, annotationKey, {
    field: "comment",
    value: comment,
  });
});

/** Replace one text field of an Annotation. An empty string clears it. */
const writeText = Effect.fnUntraced(function* (
  core: CoreState,
  annotationKey: string,
  { field, value, run }: { field: TextField; value: string; run?: WriteTurn },
) {
  const spec = TEXT_FIELD_SPECS[field];
  return yield* command(core, annotationKey, {
    write: field,
    attempted: value,
    request: (target) => spec.request(target, value),
    propose: () => spec.propose(value),
    run,
  });
});

/**
 * Save one Geometry Edit: the new position, the Sort Index recomputed from
 * it, and for a highlight or underline the quoted text. The record Zotero
 * answers after the write is what the marks and cards draw next.
 *
 * @param annotationKey the Annotation's Indexed Key.
 * @param geometry.edit its Sort Index was computed from the unrounded
 *   position.
 * @param geometry.input what made the edit. A run of keyboard edits on one
 *   Annotation is one History Step; a pointer gesture is a step of its own.
 * @see apps/obsidian/docs/adr/0040-the-sort-index-and-page-label-are-computed-in-obsidian-from-a-port-of-zoteros-text-structure.md
 */
const patchGeometry = Effect.fnUntraced(function* (
  core: CoreState,
  annotationKey: string,
  { edit, input }: { edit: GeometryEdit; input: GeometryInput },
) {
  if (writePosition(edit.position).length > MAX_POSITION_LENGTH) {
    yield* Effect.logDebug(
      "A Geometry Edit's position is longer than Zotero accepts",
    ).pipe(Effect.annotateLogs({ annotationKey }));
    return settle(core, annotationKey, "geometry", {
      kind: "failed",
      failure: { kind: "position-too-large" },
    });
  }
  return yield* command(core, annotationKey, {
    write: "geometry",
    attempted: edit,
    input,
    request: (target, record) => geometryPatch(target, record.type, edit),
    propose: (record) => proposedGeometry(record, edit),
    ...(input === "keyboard" && {
      join: { input, at: toInstant(yield* DateTime.now) },
    }),
  });
});

/**
 * Erase one Annotation in Zotero. The record leaves the Attachment's list
 * only once Zotero has answered, so the card and the Annotation Mark stand
 * until the delete is real.
 *
 * @param annotationKey the Annotation's Indexed Key.
 */
const deleteAnnotation = Effect.fnUntraced(function* (
  core: CoreState,
  annotationKey: string,
) {
  return yield* erase(core, annotationKey);
});

/**
 * @param gather where a delete of a group puts its landed write, rather than
 *   recording a step of its own.
 */
const erase = Effect.fnUntraced(function* (
  core: CoreState,
  annotationKey: string,
  gather?: GroupWrites,
) {
  for (const field of TEXT_FIELDS) {
    const draft = draftFor(core, field, annotationKey);
    if (draft) cancelTextSave(core, field, draft);
  }
  return yield* command(core, annotationKey, {
    write: "delete",
    attempted: null,
    request: eraseRequest,
    settle: "drop",
    ...(gather && { gather }),
  });
});

/**
 * Erase a group of Annotations in Zotero, from one gesture on the Card
 * Selection. Each Annotation goes out as a request of its own and keeps its
 * own outcome, a Write Conflict included. The deletes that land are one
 * History Step, so one undo puts all of them back; a delete that did not
 * land is not in it. A lock on one Annotation refuses the whole group, so
 * none goes out and no draft of the group is ended.
 *
 * @param annotationKeys Indexed Keys, in the order the step names them.
 * @returns one outcome per key, in the order of `annotationKeys`.
 */
const deleteAnnotations = Effect.fnUntraced(function* (
  core: CoreState,
  annotationKeys: readonly string[],
) {
  return yield* groupWrite(
    core,
    { kind: "existence", annotationKeys },
    (key, gather) => erase(core, key, gather),
  );
});

/**
 * Send one write per Annotation of a group at once, and record what landed
 * as one History Step once every write has settled. A write another surface
 * confirms meanwhile is a step of its own and stays below this one, so one
 * undo still takes the whole group.
 *
 * A write that threw is an outcome ZotLit never learned, so the other
 * Annotations keep theirs.
 *
 * Every lock is read before any write starts. Where one refuses the verb,
 * nothing is sent: the first refused Annotation answers its `locked`
 * failure, so the notice names its Lock Reason once, and every other
 * Annotation answers `idle`.
 *
 * @param group.kind the one kind of step every write of the group joins.
 * @param group.annotationKeys Indexed Keys, in the order the step names them.
 * @param write one Annotation's write, which puts what it landed in `gather`.
 * @returns one outcome per key, in the order of `annotationKeys`.
 */
const groupWrite = Effect.fnUntraced(function* <E>(
  core: CoreState,
  {
    kind,
    annotationKeys,
  }: { kind: GroupKind; annotationKeys: readonly string[] },
  write: (
    annotationKey: string,
    gather: GroupWrites,
  ) => Effect.Effect<MutationState, E>,
) {
  // A group verb is all or nothing, as in Zotero's reader: one Annotation
  // the lock refuses keeps every write of the group from going out.
  const locked = yield* firstHeldLockRefusal(core, annotationKeys, kind);
  if (locked)
    return annotationKeys.map((key): MutationState =>
      key === locked.annotationKey
        ? { kind: "failed", failure: locked.failure }
        : IDLE,
    );
  const gather: GroupWrites = { kind, writes: [] };
  const settled = yield* Effect.forEach(
    annotationKeys,
    (annotationKey) =>
      write(annotationKey, gather).pipe(
        recover(
          (cause) =>
            Effect.logWarning("A write of a group threw", cause).pipe(
              Effect.annotateLogs({ annotationKey }),
            ),
          Effect.succeed(UNKNOWN_OUTCOME),
        ),
      ),
    { concurrency: "unbounded" },
  );
  const byAttachment = Map.groupBy(
    gather.writes,
    (entry) => entry.attachmentKey,
  );
  for (const [attachmentKey, writes] of byAttachment)
    yield* recordGroup(core, annotationKeys, { attachmentKey, kind, writes });
  return settled;
});

/**
 * Send one conflicted write again, against the value Zotero holds now — the
 * card's "Apply again", and its "Delete anyway". The user has seen both
 * values by then, so this asks for the same change with the fresh version as
 * its precondition.
 *
 * @param annotationKey the Annotation's Indexed Key.
 * @returns what the second write left, which is `idle` where it landed and
 *   another conflict where Zotero moved again.
 */
const retryWrite = Effect.fnUntraced(function* (
  core: CoreState,
  annotationKey: string,
) {
  const standing = standingOutcome(core, annotationKey);
  if (standing?.kind !== "conflict") return standing ?? IDLE;
  const { conflict } = standing;
  switch (conflict.write) {
    case "color":
      return yield* patchColor(core, annotationKey, conflict.attempted ?? "");
    case "comment":
    case "text":
      return yield* writeText(core, annotationKey, {
        field: conflict.write,
        value: conflict.attempted ?? "",
      });
    case "delete":
      return yield* deleteAnnotation(core, annotationKey);
    case "geometry":
      return yield* patchGeometry(core, annotationKey, {
        edit: conflict.attempted,
        // The re-send is the very edit the conflict refused, so a nudge goes
        // again as a nudge and the run it belongs to stays one step.
        input: conflict.input,
      });
  }
});

/**
 * Leave Zotero's copy as it stands, from the card's "Discard". The card goes
 * back to what the last read answered; nothing is sent.
 *
 * @param annotationKey the Annotation's Indexed Key.
 */
const discardConflict = Effect.fnUntraced(function* (
  core: CoreState,
  annotationKey: string,
) {
  const standing = standingOutcome(core, annotationKey);
  if (standing?.kind !== "conflict") return;
  yield* Effect.logDebug("A write conflict was discarded").pipe(
    Effect.annotateLogs({ annotationKey }),
  );
  settle(core, annotationKey, standing.conflict.write, IDLE);
});

/**
 * One command, from the record it stamps its precondition off to the state it
 * leaves on the card.
 *
 * Everything a write needs comes from the list the active source already
 * answered, which is what makes a command take keys alone. The database
 * partition supplies committed versions for source handoff, but writes wait
 * for an active Local API source and its authorization state.
 *
 * Every mutation requires an existing authorization.
 *
 * The write is a mutation on the query client's mutation cache, which runs
 * the writes of one Annotation one at a time. Query Core calls the write for
 * a Promise: it runs on the layer's bridge, so the layer's close interrupts
 * it, and the write then answers that its outcome is not known.
 *
 * @param command.write which verb this is, so a conflict can name the two
 *   values the card puts side by side.
 * @param command.attempted the value the user asked for; `null` for a delete.
 * @param command.request the request, built against the held record's
 *   version and type.
 * @param command.settle whether the Annotation is read back after the `204`,
 *   or leaves the list because the write erased it.
 * @param command.join what a confirmed edit joins the step before it by,
 *   where the edit came from an input that runs.
 * @see apps/obsidian/docs/adr/0034-the-annotation-source-is-atomic-per-attachment.md
 * @see apps/obsidian/docs/adr/0038-write-authorization-starts-only-from-a-user-gesture.md
 */
const command = Effect.fnUntraced(function* (
  core: CoreState,
  annotationKey: string,
  command: Command,
): Effect.fn.Return<MutationState, WriteRunFailed> {
  // A lock refuses the write before it is built, so no Pending Proposal is
  // drawn and a Write Conflict standing on the Annotation stays.
  const locked = yield* lockRefusal(core, annotationKey, command.write);
  if (locked) return { kind: "failed", failure: locked };
  const expectedServerID = (yield* demandedSource(core))?.serverID ?? null;
  const generation = core.commandGeneration;
  const held = yield* holding(core, annotationKey);
  const proposal: PendingProposal | null =
    held && command.propose
      ? {
          annotationKey,
          attachmentKey: held.attachmentKey,
          serverID: expectedServerID,
          fields: command.propose(held.record),
        }
      : null;
  const queued = { expectedServerID, generation, ...command };
  const { client } = core.queries;
  const mutation: AnnotationMutation = client.getMutationCache().build(client, {
    mutationKey: [ANNOTATIONS, annotationKey, command.write],
    // One write per Annotation at a time, in the order they were asked for.
    scope: { id: JSON.stringify([ANNOTATIONS, annotationKey]) },
    // Zotero runs on this device, so no write waits for an online event.
    networkMode: "always",
    mutationFn: () => {
      // A close of the layer interrupts the write: before Zotero answered the
      // send, its outcome is unknown; after, the write keeps that answer.
      const send = async () => {
        const progress: { answer: MutationState | null } = { answer: null };
        const exit = await core.bridge.runPromiseExit(
          runCommand(core, annotationKey, { ...queued, progress }),
        );
        return valueOr(exit, progress.answer ?? UNKNOWN_OUTCOME);
      };
      return command.run ? command.run(send, mutation) : send();
    },
  });
  // The mutation holds its proposal from here on, so a surface redrawing on
  // this announcement draws it in the same task.
  core.pendingStates.set(mutation, {
    kind: "pending",
    write: command.write,
    ...("session" in command && command.session && { session: true }),
  });
  const operation = mutation.execute(proposal);
  core.operations.set(mutation, operation);
  if (proposal) {
    core.publish({
      _tag: "annotations-changed",
      attachmentKey: proposal.attachmentKey,
    });
  }
  core.publish({ _tag: "annotation-changed", annotationKey });
  // A write that settles lets its proposal go: confirmed, the list already
  // holds the same value; refused, the confirmed value is drawn again. What
  // it left on the Annotation is announced in the same turn, on the
  // mutation's own Promise, before any caller of the write resumes.
  const settled = () => {
    if (proposal) {
      core.publish({
        _tag: "annotations-changed",
        attachmentKey: proposal.attachmentKey,
      });
    }
    core.publish({ _tag: "annotation-changed", annotationKey });
  };
  void operation.then(settled, settled);
  return yield* counted(
    core,
    attachmentHolding(core, annotationKey),
    Effect.tryPromise({
      try: () => operation,
      catch: (cause) => new WriteRunFailed({ cause }),
    }),
  );
});

const runCommand: (
  core: CoreState,
  annotationKey: string,
  command: QueuedCommand,
) => Effect.Effect<MutationState, WriteReadError> = Effect.fnUntraced(
  function* (core, annotationKey, command) {
    const held = yield* prepareWrite(core, annotationKey);
    if (held === "server-changed") {
      return leave(core, annotationKey, command.write, {
        kind: "failed",
        failure: { kind: "server-changed" },
      });
    }
    if (command.generation !== core.commandGeneration) {
      return UNKNOWN_OUTCOME;
    }
    if (
      ((yield* demandedSource(core))?.serverID ?? null) !==
      command.expectedServerID
    ) {
      return { kind: "failed", failure: { kind: "server-changed" } };
    }
    const parsed = parseIndexedKey(annotationKey);
    if (!held || !parsed) {
      return leave(core, annotationKey, command.write, {
        kind: "failed",
        failure: { kind: "unknown-annotation" },
      });
    }
    if (!(yield* compatibleApiSource(core, held.attachmentKey))) {
      return leave(core, annotationKey, command.write, {
        kind: "failed",
        failure: { kind: "db-source" },
      });
    }
    const { version } = held.record;
    if (version === null) {
      return leave(core, annotationKey, command.write, {
        kind: "failed",
        failure: { kind: "db-source" },
      });
    }

    // The write takes over its field: a failure on the Annotation, or a
    // conflict of this field, is over once this one runs.
    takeOver(core, annotationKey, command.write);
    const blocked = yield* writeBlocked(core, held.attachmentKey);
    if (blocked) {
      return leave(core, annotationKey, command.write, {
        kind: "failed",
        failure: blocked,
      });
    }

    // The lock is read before the write goes out: a database read after it
    // no longer holds a deleted Annotation, and so no longer its lock.
    const lock = core.locks.get(held.attachmentKey)?.get(annotationKey)?.reason;
    const library = libraryPath(parsed);
    const { path, method, headers, body } = command.request(
      { library, key: parsed.key, version },
      held.record,
    );
    const source = yield* compatibleApiSource(core, held.attachmentKey);
    // A second send (a tag write applied again) starts with no answer.
    if (command.progress) command.progress.answer = null;
    const reply = yield* core.localApi.authorizedSend(path, {
      library,
      method,
      headers,
      body,
    });
    if (command.progress) {
      command.progress.answer =
        "failure" in reply ? { kind: "failed", failure: reply.failure } : IDLE;
    }
    if (
      !source ||
      !(yield* sourceStillBound(core, held.attachmentKey, source))
    ) {
      if (
        core.databaseBindings.get(held.attachmentKey)?.source.database
          .serverID !== source?.serverID
      ) {
        return { kind: "failed", failure: { kind: "server-changed" } };
      }
      return leave(core, annotationKey, command.write, {
        kind: "failed",
        failure: { kind: "server-changed" },
      });
    }
    if ("failure" in reply) {
      yield* Effect.logDebug("Zotero refused a write").pipe(
        Effect.annotateLogs({ annotationKey, method, failure: reply.failure }),
      );
      const refused = yield* writeRefused(core, held, {
        ...command,
        failure: reply.failure,
        source,
      });
      if (refused.kind === "re-apply" && !command.reapplied) {
        yield* Effect.logDebug(
          "A tag write applies its names again to fresh tags",
        ).pipe(Effect.annotateLogs({ annotationKey }));
        return yield* runCommand(core, annotationKey, {
          ...command,
          reapplied: true,
        });
      }
      const state: MutationState =
        refused.kind === "re-apply"
          ? { kind: "failed", failure: reply.failure }
          : refused;
      if (state.kind === "failed") yield* refresh(core, held.attachmentKey);
      leave(core, annotationKey, command.write, state);
      if (state.kind === "conflict") {
        core.publish({
          _tag: "write-conflict",
          annotationKey,
          attachmentKey: held.attachmentKey,
        });
      }
      return state;
    }

    yield* Effect.logDebug("Zotero took a write").pipe(
      Effect.annotateLogs({ annotationKey, method }),
    );
    rememberAcknowledgedRevision(core, held.attachmentKey, reply.value.headers);
    const applied = yield* applyWrite(core, held, {
      write: command.write,
      settle: command.settle ?? "re-read",
      lock,
    });
    if ("failure" in applied) {
      yield* refresh(core, held.attachmentKey);
      return leave(core, annotationKey, command.write, {
        kind: "failed",
        failure: applied.failure,
      });
    }
    if (command.settle === "drop") {
      dropDrafts(core, annotationKey);
    }
    if (
      !(yield* sourceStillBound(core, held.attachmentKey, source)) ||
      !(yield* publishApiChange(
        core,
        { attachmentKey: held.attachmentKey, source },
        applied.value,
      ))
    ) {
      return leave(core, annotationKey, command.write, {
        kind: "failed",
        failure: { kind: "server-changed" },
      });
    }
    yield* refresh(core, held.attachmentKey);
    if (command.gather) {
      command.gather.writes.push({
        attachmentKey: held.attachmentKey,
        before: held.record,
        applied: applied.value,
      });
    } else {
      yield* recordStep(core, held.record, {
        attachmentKey: held.attachmentKey,
        applied: applied.value,
        join: command.join,
      });
    }
    core.publish({
      _tag: "annotations-changed",
      attachmentKey: held.attachmentKey,
    });
    return leave(core, annotationKey, command.write, IDLE);
  },
);

/**
 * Count one write against its Attachment while it is in flight, which is what
 * the Annotation History's guard reads.
 *
 * @param attachmentKey the Attachment the write lands on, or `undefined`
 *   where no list holds the Annotation and the write will refuse itself.
 */
function counted<A, E>(
  core: CoreState,
  attachmentKey: string | undefined,
  work: Effect.Effect<A, E>,
): Effect.Effect<A, E> {
  if (attachmentKey === undefined) return work;
  return Effect.acquireUseRelease(
    Effect.sync(() => {
      core.writesInFlight.set(
        attachmentKey,
        (core.writesInFlight.get(attachmentKey) ?? 0) + 1,
      );
    }),
    () => work,
    () => uncount(core, attachmentKey),
  );
}

/**
 * The end of one counted write. The last write on an Attachment while no
 * Local API source stands reads its list again from the Zotero database, on
 * the layer's Scope.
 */
const uncount = Effect.fnUntraced(function* (
  core: CoreState,
  attachmentKey: string,
) {
  const left = (core.writesInFlight.get(attachmentKey) ?? 1) - 1;
  if (left > 0) {
    core.writesInFlight.set(attachmentKey, left);
    return;
  }
  core.writesInFlight.delete(attachmentKey);
  if (yield* demandedSource(core)) return;
  yield* FiberSet.run(
    core.fibers,
    read(core, attachmentKey).pipe(
      recover(
        (cause) =>
          Effect.logDebug(
            "The database fallback after a write could not be read",
            cause,
          ).pipe(Effect.annotateLogs({ attachmentKey })),
        Effect.void,
      ),
    ),
  );
});

/**
 * The `locked` failure one verb meets on an Annotation; see
 * {@link firstHeldLockRefusal}.
 *
 * @param annotationKey the Annotation's Indexed Key.
 */
const lockRefusal = Effect.fnUntraced(function* (
  core: CoreState,
  annotationKey: string,
  verb: LockedVerb,
) {
  return (
    (yield* firstHeldLockRefusal(core, [annotationKey], verb))?.failure ?? null
  );
});

/**
 * The first lock that refuses a write of `kind` over these Annotations: one
 * write, the writes of a group verb, and the Annotations one History Step
 * changes. The Editing Capability keeps priority: a lock on an Attachment
 * whose capability refuses the write too stands aside, and the write meets
 * the capability's own refusal, whose reason can carry an action.
 *
 * @param annotationKeys Indexed Keys, in the order the first is picked from.
 * @param kind the kind of write; a History Step's `existence` is a delete.
 * @returns the first refused Annotation with its `locked` failure, or `null`
 *   where every lock allows the write.
 */
const firstHeldLockRefusal = Effect.fnUntraced(function* (
  core: CoreState,
  annotationKeys: readonly string[],
  kind: LockedVerb | HistoryStep["kind"],
): Effect.fn.Return<{
  annotationKey: string;
  failure: LockedFailure;
} | null> {
  const verb: LockedVerb = kind === "existence" ? "delete" : kind;
  const refused = Option.getOrNull(
    yield* Effect.findFirstFilter(annotationKeys, (annotationKey) =>
      writeLock(core, annotationKey).pipe(
        Effect.map((lock) =>
          lock && lockRefuses(lock, verb)
            ? Result.succeed({ annotationKey, lock })
            : Result.fail(undefined),
        ),
      ),
    ),
  );
  if (!refused) return null;
  const { annotationKey, lock } = refused;
  yield* Effect.logDebug("A lock refused a write").pipe(
    Effect.annotateLogs({ annotationKey, verb, reason: lock.reason }),
  );
  return { annotationKey, failure: { kind: "locked", reason: lock.reason } };
});

/**
 * The lock a write meets on one Annotation, or `null` where it has none or
 * where the Editing Capability of its Attachment refuses the write first.
 */
const writeLock = Effect.fnUntraced(function* (
  core: CoreState,
  annotationKey: string,
): Effect.fn.Return<AnnotationLock | null> {
  for (const [attachmentKey, locks] of core.locks) {
    const lock = locks.get(annotationKey);
    if (lock) return (yield* writeBlocked(core, attachmentKey)) ? null : lock;
  }
  return null;
});

const writeBlocked = Effect.fnUntraced(function* (
  core: CoreState,
  attachmentKey: string,
): Effect.fn.Return<WriteFailure | null> {
  const capability = yield* editingCapability(core, attachmentKey);
  switch (capability.kind) {
    case "writable":
      return null;
    case "authorization-required":
    case "authorizing":
      return { kind: "unauthorized" };
    case "cooldown":
      return {
        kind: "cooldown",
        retryAfter: DateTime.distance(
          yield* DateTime.now,
          fromInstant(capability.retryAfter),
        ),
      };
    case "read-only":
      if (
        capability.reason === "probing" ||
        capability.reason === "zotero-unavailable"
      )
        return { kind: "unreachable" };
      if (capability.reason === "invalid-response")
        return {
          kind: "invalid-response",
          issue: "Zotero response unavailable",
        };
      return { kind: capability.reason };
  }
});

/**
 * What a refused write leaves on the card.
 *
 * A version `412` invalidates the Attachment's list whatever it turns out to
 * mean: the write proved that what ZotLit holds is behind Zotero. The
 * Annotation is then read back on its own, so the card can put Zotero's value
 * beside the user's — and so the next write stamps the version Zotero holds
 * now rather than the one that just failed. An equal fresh value resolves
 * silently: the user's change is already what stands.
 *
 * A `404` is the other end of the same story — Zotero no longer holds the
 * Annotation — so the list drops and the card leaves on the next read.
 *
 * A tag write never conflicts: once the fresh record stands in the list, it
 * answers `re-apply`, and the same names are applied to the fresh tags.
 *
 * @param refusal.source the Local API source the write was sent through.
 * @see https://github.com/aidenlx/zotlit/issues/1139 — "Editing Capability and degraded states"
 * @see apps/obsidian/docs/adr/0063-annotation-tags-save-once-per-editing-session-and-merge-by-name.md
 */
const writeRefused = Effect.fnUntraced(function* (
  core: CoreState,
  held: HeldAnnotation,
  refusal: WriteAttempt & { failure: WriteFailure; source: LocalApiSource },
): Effect.fn.Return<MutationState | { kind: "re-apply" }, WriteReadError> {
  const { failure, source } = refusal;
  const annotationKey = held.record.key;
  if (failure.kind === "not-found") {
    yield* dropAttachment(core, held.attachmentKey, held.queryKey);
    return { kind: "failed", failure };
  }
  if (failure.kind !== "conflict") return { kind: "failed", failure };

  const fresh = yield* core.localApi.readAnnotation(
    annotationKey,
    held.attachmentKey,
  );
  if ("failure" in fresh) {
    yield* Effect.logDebug(
      "A conflicted annotation could not be read back",
    ).pipe(Effect.annotateLogs({ annotationKey, failure: fresh.failure }));
    yield* dropAttachment(core, held.attachmentKey, held.queryKey);
    return {
      kind: "failed",
      failure: fresh.failure.kind === "not-found" ? fresh.failure : failure,
    };
  }

  const record = fromLocalApi(fresh.value);
  if (
    !(yield* sourceStillBound(core, held.attachmentKey, source)) ||
    !(yield* publishApiChange(
      core,
      { attachmentKey: held.attachmentKey, source },
      { kind: "observed", record },
    ))
  ) {
    return { kind: "failed", failure: { kind: "server-changed" } };
  }
  yield* dropAttachment(core, held.attachmentKey, held.queryKey);

  if (refusal.write === "tags") return { kind: "re-apply" };
  const conflict = conflictOf(refusal, record);
  if (!conflict) {
    yield* Effect.logDebug(
      "A write conflict resolved to the value Zotero holds",
    ).pipe(Effect.annotateLogs({ annotationKey, write: refusal.write }));
    return IDLE;
  }
  return { kind: "conflict", conflict };
});

/**
 * The Attachment's list, once Zotero has taken the write.
 *
 * A patch reads the Annotation back rather than believing its own input: the
 * `204` carries the library's version, not the object's, and the next write
 * needs the object's. A re-read that does not answer drops the list instead,
 * so the Attachment reconciles on its next read rather than holding a record
 * whose version is known to be stale.
 */
const applyWrite = Effect.fnUntraced(function* (
  core: CoreState,
  held: HeldAnnotation,
  {
    write,
    settle,
    lock,
  }: {
    write: ConflictedWrite | "tags";
    settle: "re-read" | "drop";
    /** The Lock Reason the Annotation stood under when the write was sent. */
    lock: LockReason | undefined;
  },
): Effect.fn.Return<{ value: ConfirmedWrite } | { failure: LocalApiFailure }> {
  const { queryKey, attachmentKey, record: sent } = held;
  const annotationKey = sent.key;
  if (settle === "drop") {
    return {
      value: { kind: "deleted", annotationKey, ...(lock && { lock }) },
    };
  }
  const fresh = yield* core.localApi.readAnnotation(
    annotationKey,
    attachmentKey,
  );
  if ("failure" in fresh) {
    yield* Effect.logDebug("A written annotation could not be read back").pipe(
      Effect.annotateLogs({ annotationKey, failure: fresh.failure }),
    );
    yield* invalidate(core, queryKey);
    return fresh;
  }
  const record = fromLocalApi(fresh.value);
  return {
    value: {
      kind: "record",
      record,
      write: write === "delete" ? "color" : write,
    },
  };
});

/**
 * Publish API confirmations independently of the transport cache's lifetime.
 *
 * @param target.source the Local API source the confirmation came through.
 */
const publishApiChange = Effect.fnUntraced(function* (
  core: CoreState,
  { attachmentKey, source }: { attachmentKey: string; source: LocalApiSource },
  confirmation: AnnotationConfirmation,
) {
  const previous = core.publishedLists.get(attachmentKey);
  if (
    !previous ||
    previous.source.kind !== "zotero-local-api" ||
    previous.source.serverID !== source.serverID
  )
    return false;
  const key = confirmationKey(confirmation);
  const annotations = previous.annotations.filter(
    (record) => record.key !== key,
  );
  if (confirmation.kind !== "deleted") {
    const index = previous.annotations.findIndex(
      (record) => record.key === key,
    );
    annotations.splice(
      index < 0 ? annotations.length : index,
      0,
      confirmation.record,
    );
  }
  const next = { ...previous, annotations };
  const confirmations = core.confirmedWrites.get(attachmentKey) ?? [];
  core.confirmedWrites.set(attachmentKey, [
    ...confirmations.filter((existing) => confirmationKey(existing) !== key),
    confirmation,
  ]);
  core.publishedLists.set(attachmentKey, next);
  core.publishedStatuses.set(attachmentKey, "fresh");
  if (confirmation.kind === "deleted") {
    reconcileDrafts(core, source.serverID, attachmentKey, annotations);
  }
  yield* announceReadPixels(core, previous, next);
  return true;
});

function confirmationKey(confirmation: AnnotationConfirmation): string {
  return confirmation.kind === "deleted"
    ? confirmation.annotationKey
    : confirmation.record.key;
}

/**
 * The Write Conflict a refused write leaves against the record Zotero holds
 * now, or `null` where that record already holds what the write asked for.
 */
function conflictOf(
  attempt: Exclude<WriteAttempt, { write: "tags" }>,
  record: AnnotationRecord,
): WriteConflict | null {
  if (attempt.write === "geometry") {
    const fresh = { position: record.position, text: record.text };
    return sameStoredGeometry(attempt.attempted, fresh)
      ? null
      : {
          write: "geometry",
          attempted: attempt.attempted,
          input: attempt.input,
          fresh,
        };
  }
  const { write, attempted } = attempt;
  const fresh = freshValueOf(record, write);
  return resolvesSilently(write, attempted, fresh)
    ? null
    : { write, attempted, fresh };
}

/** One record's tags with their types, as a tag write merges into them. */
/**
 * A Geometry Edit as the record Zotero answers after the write holds it: the
 * position rounded as it is sent and parsed as a read parses it, the Sort
 * Index, and a highlight's or underline's quoted text.
 */
function proposedGeometry(
  record: AnnotationRecord,
  edit: GeometryEdit,
): ProposedFields {
  const position = parseAnnotationPosition(
    JSON.parse(writePosition(edit.position)) as AnnotationPositionRaw,
    "application/pdf",
  );
  const quotes = record.type === "highlight" || record.type === "underline";
  return {
    ...(position.kind !== "unknown" && { position }),
    sortIndex: edit.sortIndex,
    ...(quotes &&
      edit.text !== undefined && {
        text: edit.text === "" ? null : edit.text,
      }),
  };
}

export {
  UNKNOWN_OUTCOME,
  createAnnotation,
  patchColor,
  patchColors,
  patchComment,
  writeText,
  patchGeometry,
  deleteAnnotation,
  deleteAnnotations,
  retryWrite,
  discardConflict,
  command,
  lockRefusal,
  firstHeldLockRefusal,
  writeBlocked,
};
export type { WriteReadError };
