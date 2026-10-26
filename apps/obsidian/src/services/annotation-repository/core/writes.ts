// Writes and conflicts: every command to Zotero, run one at a time per Annotation, and what its answer leaves behind.
import { parseAnnotationPosition, parseIndexedKey } from "@zotlit/db";
import type { AnnotationPositionRaw } from "@zotlit/db";

import { getLogger } from "@/lib/log";
import { contentOf } from "@/services/annotation-repository/history";
import type {
  HistoryJoin,
  HistoryStep,
} from "@/services/annotation-repository/history";
import { firstLockRefusal } from "@/services/annotation-repository/lock";
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
import { cooldownFailure } from "@/services/zotero-local-api/plain";
import type {
  LocalApiFailure,
  LocalApiSource,
} from "@/services/zotero-local-api/service";
import {
  libraryPath,
  readCreateResult,
} from "@/services/zotero-local-api/wire";

import { demandedSource, invalidate } from "./bridge";
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

const logger = getLogger("annotation-repository");

/** The write failure a lock gives, with its Lock Reason. */
type LockedFailure = Extract<WriteFailure, { kind: "locked" }>;

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
 * @param draft everything about the Annotation except its parent, which this
 *   Attachment names; its Sort Index was computed from the unrounded position.
 * @param options.group what joins this create to the others of one gesture in
 *   the Annotation History — one ink stroke split at the position ceiling
 *   creates several Annotations and is still one History Step. A create that
 *   names none is a step of its own.
 * @see apps/obsidian/docs/adr/0038-write-authorization-starts-only-from-a-user-gesture.md
 */
async function createAnnotation(
  core: CoreState,
  attachmentKey: string,
  draft: Omit<AnnotationDraft, "parentKey">,
  options: { group?: string } = {},
): Promise<CreateOutcome> {
  return await counted(
    core,
    attachmentKey,
    sendCreate(core, attachmentKey, draft, options.group),
  );
}

async function sendCreate(
  core: CoreState,
  attachmentKey: string,
  draft: Omit<AnnotationDraft, "parentKey">,
  group: string | undefined,
): Promise<CreateOutcome> {
  const parsed = parseIndexedKey(attachmentKey);
  if (!parsed) {
    return { kind: "failed", failure: { kind: "unknown-annotation" } };
  }
  const expectedSource = compatibleApiSource(core, attachmentKey);
  if (!expectedSource) {
    return { kind: "failed", failure: { kind: "db-source" } };
  }
  if (!(await prepareCollection(core, attachmentKey, expectedSource))) {
    return { kind: "failed", failure: { kind: "server-changed" } };
  }
  const whole = { ...draft, parentKey: parsed.key };
  if (writePosition(whole.position).length > MAX_POSITION_LENGTH) {
    logger.debug("A selection's position is longer than Zotero accepts", {
      attachmentKey,
    });
    return { kind: "failed", failure: { kind: "position-too-large" } };
  }

  const blocked = writeBlocked(core, attachmentKey);
  if (blocked) return { kind: "failed", failure: blocked };

  const library = libraryPath(parsed);
  const request = createRequest(library, whole, core.writeToken());
  const source = compatibleApiSource(core, attachmentKey);
  const reply = await core.bridge.runPromise(
    core.localApi.authorizedSend(request.path, {
      library,
      method: request.method,
      headers: request.headers,
      body: request.body,
    }),
  );
  if (!source || !(await sourceStillBound(core, attachmentKey, source))) {
    return { kind: "failed", failure: { kind: "server-changed" } };
  }
  if ("failure" in reply) {
    logger.debug("Zotero did not confirm an annotation create", {
      attachmentKey,
      failure: reply.failure,
    });
    await refresh(core, attachmentKey);
    return { kind: "failed", failure: reply.failure };
  }

  const created = readCreateResult(reply.value.text, {
    parentKey: attachmentKey,
    type: whole.type,
  });
  if ("failure" in created) {
    await refresh(core, attachmentKey);
    return { kind: "failed", failure: created.failure };
  }

  const annotationKey = created.value.key;
  rememberAcknowledgedRevision(core, attachmentKey, reply.value.headers);
  const record = fromLocalApi(created.value);
  if (
    !(await publishApiChange(core, attachmentKey, source, {
      kind: "created",
      record,
    }))
  )
    return { kind: "failed", failure: { kind: "server-changed" } };
  await refresh(core, attachmentKey);
  logger.debug("Zotero created an annotation", {
    attachmentKey,
    annotationKey,
    type: whole.type,
  });
  const content = contentOf(record);
  if (content) {
    recordExistence(
      core,
      attachmentKey,
      { annotationKey, before: { content: null }, after: { content } },
      group,
    );
  }
  core.publish({ _tag: "annotations-changed", attachmentKey });
  return { kind: "created", annotationKey };
}

/**
 * Recolour one Annotation, of whatever type: Zotero's colour setter is one
 * rule for all six, so an ink stroke recolours like a highlight.
 *
 * @param annotationKey the Annotation's Indexed Key.
 * @param color the swatch to store, in any case; the write sends lower case.
 */
async function patchColor(
  core: CoreState,
  annotationKey: string,
  color: string,
): Promise<MutationState> {
  return await recolor(core, annotationKey, color);
}

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
async function patchColors(
  core: CoreState,
  annotationKeys: readonly string[],
  color: string,
): Promise<MutationState[]> {
  return await groupWrite(core, "color", annotationKeys, (key, gather) =>
    recolor(core, key, color, gather),
  );
}

/**
 * @param gather where a recolour of a group puts its landed write, rather
 *   than recording a step of its own.
 */
async function recolor(
  core: CoreState,
  annotationKey: string,
  color: string,
  gather?: GroupWrites,
): Promise<MutationState> {
  return await command(core, annotationKey, {
    write: "color",
    attempted: color,
    request: (target) => colorPatch(target, color),
    propose: () => ({ color: wireColor(color) }),
    ...(gather && { gather }),
  });
}

/**
 * Replace one Annotation's comment. An empty string clears it.
 *
 * @param annotationKey the Annotation's Indexed Key.
 */
async function patchComment(
  core: CoreState,
  annotationKey: string,
  comment: string,
): Promise<MutationState> {
  return await writeText(core, "comment", annotationKey, { value: comment });
}

/** Replace one text field of an Annotation. An empty string clears it. */
async function writeText(
  core: CoreState,
  field: TextField,
  annotationKey: string,
  { value, run }: { value: string; run?: WriteTurn },
): Promise<MutationState> {
  const spec = TEXT_FIELD_SPECS[field];
  return await command(core, annotationKey, {
    write: field,
    attempted: value,
    request: (target) => spec.request(target, value),
    propose: () => spec.propose(value),
    run,
  });
}

/**
 * Save one Geometry Edit: the new position, the Sort Index recomputed from
 * it, and for a highlight or underline the quoted text. The record Zotero
 * answers after the write is what the marks and cards draw next.
 *
 * @param annotationKey the Annotation's Indexed Key.
 * @param edit its Sort Index was computed from the unrounded position.
 * @param input what made the edit. A run of keyboard edits on one Annotation
 *   is one History Step; a pointer gesture is a step of its own.
 * @see apps/obsidian/docs/adr/0040-the-sort-index-and-page-label-are-computed-in-obsidian-from-a-port-of-zoteros-text-structure.md
 */
async function patchGeometry(
  core: CoreState,
  annotationKey: string,
  edit: GeometryEdit,
  input: GeometryInput,
): Promise<MutationState> {
  if (writePosition(edit.position).length > MAX_POSITION_LENGTH) {
    logger.debug("A Geometry Edit's position is longer than Zotero accepts", {
      annotationKey,
    });
    return settle(core, annotationKey, "geometry", {
      kind: "failed",
      failure: { kind: "position-too-large" },
    });
  }
  return await command(core, annotationKey, {
    write: "geometry",
    attempted: edit,
    input,
    request: (target, record) => geometryPatch(target, record.type, edit),
    propose: (record) => proposedGeometry(record, edit),
    ...(input === "keyboard" && {
      join: { input, at: core.now() },
    }),
  });
}

/**
 * Erase one Annotation in Zotero. The record leaves the Attachment's list
 * only once Zotero has answered, so the card and the Annotation Mark stand
 * until the delete is real.
 *
 * @param annotationKey the Annotation's Indexed Key.
 */
async function deleteAnnotation(
  core: CoreState,
  annotationKey: string,
): Promise<MutationState> {
  return await erase(core, annotationKey);
}

/**
 * @param gather where a delete of a group puts its landed write, rather than
 *   recording a step of its own.
 */
async function erase(
  core: CoreState,
  annotationKey: string,
  gather?: GroupWrites,
): Promise<MutationState> {
  for (const field of TEXT_FIELDS) {
    const draft = draftFor(core, field, annotationKey);
    if (draft) cancelTextSave(core, field, draft);
  }
  return await command(core, annotationKey, {
    write: "delete",
    attempted: null,
    request: eraseRequest,
    settle: "drop",
    ...(gather && { gather }),
  });
}

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
async function deleteAnnotations(
  core: CoreState,
  annotationKeys: readonly string[],
): Promise<MutationState[]> {
  return await groupWrite(core, "existence", annotationKeys, (key, gather) =>
    erase(core, key, gather),
  );
}

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
 * @param kind the one kind of step every write of the group joins.
 * @param write one Annotation's write, which puts what it landed in `gather`.
 * @returns one outcome per key, in the order of `annotationKeys`.
 */
async function groupWrite(
  core: CoreState,
  kind: GroupKind,
  annotationKeys: readonly string[],
  write: (annotationKey: string, gather: GroupWrites) => Promise<MutationState>,
): Promise<MutationState[]> {
  // A group verb is all or nothing, as in Zotero's reader: one Annotation
  // the lock refuses keeps every write of the group from going out.
  const locked = firstHeldLockRefusal(core, annotationKeys, kind);
  if (locked)
    return annotationKeys.map((key) =>
      key === locked.annotationKey
        ? { kind: "failed", failure: locked.failure }
        : IDLE,
    );
  const gather: GroupWrites = { kind, writes: [] };
  const settled = await Promise.allSettled(
    annotationKeys.map((key) => write(key, gather)),
  );
  const byAttachment = Map.groupBy(
    gather.writes,
    (entry) => entry.attachmentKey,
  );
  for (const [attachmentKey, writes] of byAttachment)
    recordGroup(core, attachmentKey, annotationKeys, { kind, writes });
  return settled.map((result, index) => {
    if (result.status === "fulfilled") return result.value;
    logger.warn("A write of a group threw", {
      annotationKey: annotationKeys[index],
      error: result.reason,
    });
    return { kind: "failed", failure: { kind: "unknown-outcome" } };
  });
}

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
async function retryWrite(
  core: CoreState,
  annotationKey: string,
): Promise<MutationState> {
  const standing = standingOutcome(core, annotationKey);
  if (standing?.kind !== "conflict") return standing ?? IDLE;
  const { conflict } = standing;
  switch (conflict.write) {
    case "color":
      return await patchColor(core, annotationKey, conflict.attempted ?? "");
    case "comment":
    case "text":
      return await writeText(core, conflict.write, annotationKey, {
        value: conflict.attempted ?? "",
      });
    case "delete":
      return await deleteAnnotation(core, annotationKey);
    case "geometry":
      return await patchGeometry(
        core,
        annotationKey,
        conflict.attempted,
        // The re-send is the very edit the conflict refused, so a nudge goes
        // again as a nudge and the run it belongs to stays one step.
        conflict.input,
      );
  }
}

/**
 * Leave Zotero's copy as it stands, from the card's "Discard". The card goes
 * back to what the last read answered; nothing is sent.
 *
 * @param annotationKey the Annotation's Indexed Key.
 */
function discardConflict(core: CoreState, annotationKey: string): void {
  const standing = standingOutcome(core, annotationKey);
  if (standing?.kind !== "conflict") return;
  logger.debug("A write conflict was discarded", { annotationKey });
  settle(core, annotationKey, standing.conflict.write, IDLE);
}

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
async function command(
  core: CoreState,
  annotationKey: string,
  command: WriteAttempt & {
    request: (target: WriteTarget, record: AnnotationRecord) => WriteRequest;
    settle?: "re-read" | "drop";
    join?: HistoryJoin;
    /** The fields the write proposes, from the confirmed record it goes to. */
    propose?: (record: AnnotationRecord) => ProposedFields;
    run?: WriteTurn;
    gather?: GroupWrites;
  },
): Promise<MutationState> {
  // A lock refuses the write before it is built, so no Pending Proposal is
  // drawn and a Write Conflict standing on the Annotation stays.
  const locked = lockRefusal(core, annotationKey, command.write);
  if (locked) return { kind: "failed", failure: locked };
  const expectedServerID =
    core.bridge.runSync(demandedSource(core))?.serverID ?? null;
  const generation = core.commandGeneration;
  const held = holding(core, annotationKey);
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
    mutationFn: async () => {
      const send = () => runCommand(core, annotationKey, queued);
      return await (command.run?.(send, mutation) ?? send());
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
  // it left on the Annotation is announced in the same turn.
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
  return await counted(core, attachmentHolding(core, annotationKey), operation);
}

async function runCommand(
  core: CoreState,
  annotationKey: string,
  command: WriteAttempt & {
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
  },
): Promise<MutationState> {
  const held = await prepareWrite(core, annotationKey);
  if (held === "server-changed") {
    return leave(core, annotationKey, command.write, {
      kind: "failed",
      failure: { kind: "server-changed" },
    });
  }
  if (command.generation !== core.commandGeneration) {
    return { kind: "failed", failure: { kind: "unknown-outcome" } };
  }
  if (
    (core.bridge.runSync(demandedSource(core))?.serverID ?? null) !==
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
  if (!compatibleApiSource(core, held.attachmentKey)) {
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
  const blocked = writeBlocked(core, held.attachmentKey);
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
  const source = compatibleApiSource(core, held.attachmentKey);
  const reply = await core.bridge.runPromise(
    core.localApi.authorizedSend(path, {
      library,
      method,
      headers,
      body,
    }),
  );
  if (!source || !(await sourceStillBound(core, held.attachmentKey, source))) {
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
    logger.debug("Zotero refused a write", {
      annotationKey,
      method,
      failure: reply.failure,
    });
    const refused = await writeRefused(
      core,
      held,
      {
        ...command,
        failure: reply.failure,
      },
      source,
    );
    if (refused.kind === "re-apply" && !command.reapplied) {
      logger.debug("A tag write applies its names again to fresh tags", {
        annotationKey,
      });
      return await runCommand(core, annotationKey, {
        ...command,
        reapplied: true,
      });
    }
    const state: MutationState =
      refused.kind === "re-apply"
        ? { kind: "failed", failure: reply.failure }
        : refused;
    if (state.kind === "failed") await refresh(core, held.attachmentKey);
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

  logger.debug("Zotero took a write", { annotationKey, method });
  rememberAcknowledgedRevision(core, held.attachmentKey, reply.value.headers);
  const applied = await applyWrite(core, held, annotationKey, {
    write: command.write,
    settle: command.settle ?? "re-read",
    lock,
  });
  if ("failure" in applied) {
    await refresh(core, held.attachmentKey);
    return leave(core, annotationKey, command.write, {
      kind: "failed",
      failure: applied.failure,
    });
  }
  if (command.settle === "drop") {
    dropDrafts(core, annotationKey);
  }
  if (
    !(await sourceStillBound(core, held.attachmentKey, source)) ||
    !(await publishApiChange(core, held.attachmentKey, source, applied.value))
  ) {
    return leave(core, annotationKey, command.write, {
      kind: "failed",
      failure: { kind: "server-changed" },
    });
  }
  await refresh(core, held.attachmentKey);
  if (command.gather) {
    command.gather.writes.push({
      attachmentKey: held.attachmentKey,
      before: held.record,
      applied: applied.value,
    });
  } else {
    recordStep(core, held.attachmentKey, held.record, {
      applied: applied.value,
      join: command.join,
    });
  }
  core.publish({
    _tag: "annotations-changed",
    attachmentKey: held.attachmentKey,
  });
  return leave(core, annotationKey, command.write, IDLE);
}

/**
 * Count one write against its Attachment while it is in flight, which is what
 * the Annotation History's guard reads.
 *
 * @param attachmentKey the Attachment the write lands on, or `undefined`
 *   where no list holds the Annotation and the write will refuse itself.
 */
async function counted<T>(
  core: CoreState,
  attachmentKey: string | undefined,
  work: Promise<T>,
): Promise<T> {
  if (attachmentKey === undefined) return await work;
  core.writesInFlight.set(
    attachmentKey,
    (core.writesInFlight.get(attachmentKey) ?? 0) + 1,
  );
  try {
    return await work;
  } finally {
    const left = (core.writesInFlight.get(attachmentKey) ?? 1) - 1;
    if (left > 0) core.writesInFlight.set(attachmentKey, left);
    else {
      core.writesInFlight.delete(attachmentKey);
      if (!core.bridge.runSync(demandedSource(core))) {
        void read(core, attachmentKey).catch((error: unknown) => {
          logger.debug(
            "The database fallback after a write could not be read",
            { attachmentKey, error },
          );
        });
      }
    }
  }
}

/**
 * The `locked` failure one verb meets on an Annotation; see
 * {@link firstHeldLockRefusal}.
 *
 * @param annotationKey the Annotation's Indexed Key.
 */
function lockRefusal(
  core: CoreState,
  annotationKey: string,
  verb: LockedVerb,
): LockedFailure | null {
  return firstHeldLockRefusal(core, [annotationKey], verb)?.failure ?? null;
}

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
function firstHeldLockRefusal(
  core: CoreState,
  annotationKeys: readonly string[],
  kind: LockedVerb | HistoryStep["kind"],
): { annotationKey: string; failure: LockedFailure } | null {
  const verb: LockedVerb = kind === "existence" ? "delete" : kind;
  const refused = firstLockRefusal(annotationKeys, verb, (annotationKey) =>
    writeLock(core, annotationKey),
  );
  if (!refused) return null;
  const { annotationKey, lock } = refused;
  logger.debug("A lock refused a write", {
    annotationKey,
    verb,
    reason: lock.reason,
  });
  return { annotationKey, failure: { kind: "locked", reason: lock.reason } };
}

/**
 * The lock a write meets on one Annotation, or `null` where it has none or
 * where the Editing Capability of its Attachment refuses the write first.
 */
function writeLock(
  core: CoreState,
  annotationKey: string,
): AnnotationLock | null {
  for (const [attachmentKey, locks] of core.locks) {
    const lock = locks.get(annotationKey);
    if (lock) return writeBlocked(core, attachmentKey) ? null : lock;
  }
  return null;
}

function writeBlocked(
  core: CoreState,
  attachmentKey: string,
): WriteFailure | null {
  const capability = editingCapability(core, attachmentKey);
  switch (capability.kind) {
    case "writable":
      return null;
    case "authorization-required":
    case "authorizing":
      return { kind: "unauthorized" };
    case "cooldown":
      return cooldownFailure(core.now().until(capability.retryAfter));
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
}

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
 * @see https://github.com/aidenlx/zotlit/issues/1139 — "Editing Capability and degraded states"
 * @see apps/obsidian/docs/adr/0063-annotation-tags-save-once-per-editing-session-and-merge-by-name.md
 */
async function writeRefused(
  core: CoreState,
  held: HeldAnnotation,
  refusal: WriteAttempt & { failure: WriteFailure },
  source: LocalApiSource,
): Promise<MutationState | { kind: "re-apply" }> {
  const { failure } = refusal;
  const annotationKey = held.record.key;
  if (failure.kind === "not-found") {
    dropAttachment(core, held.attachmentKey, held.queryKey);
    return { kind: "failed", failure };
  }
  if (failure.kind !== "conflict") return { kind: "failed", failure };

  const fresh = await core.bridge.runPromise(
    core.localApi.readAnnotation(annotationKey, held.attachmentKey),
  );
  if ("failure" in fresh) {
    logger.debug("A conflicted annotation could not be read back", {
      annotationKey,
      failure: fresh.failure,
    });
    dropAttachment(core, held.attachmentKey, held.queryKey);
    return {
      kind: "failed",
      failure: fresh.failure.kind === "not-found" ? fresh.failure : failure,
    };
  }

  const record = fromLocalApi(fresh.value);
  if (
    !(await sourceStillBound(core, held.attachmentKey, source)) ||
    !(await publishApiChange(core, held.attachmentKey, source, {
      kind: "observed",
      record,
    }))
  ) {
    return { kind: "failed", failure: { kind: "server-changed" } };
  }
  dropAttachment(core, held.attachmentKey, held.queryKey);

  if (refusal.write === "tags") return { kind: "re-apply" };
  const conflict = conflictOf(refusal, record);
  if (!conflict) {
    logger.debug("A write conflict resolved to the value Zotero holds", {
      annotationKey,
      write: refusal.write,
    });
    return IDLE;
  }
  return { kind: "conflict", conflict };
}

/**
 * The Attachment's list, once Zotero has taken the write.
 *
 * A patch reads the Annotation back rather than believing its own input: the
 * `204` carries the library's version, not the object's, and the next write
 * needs the object's. A re-read that does not answer drops the list instead,
 * so the Attachment reconciles on its next read rather than holding a record
 * whose version is known to be stale.
 */
async function applyWrite(
  core: CoreState,
  held: HeldAnnotation,
  annotationKey: string,
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
): Promise<{ value: ConfirmedWrite } | { failure: LocalApiFailure }> {
  const { queryKey, attachmentKey } = held;
  if (settle === "drop") {
    return {
      value: { kind: "deleted", annotationKey, ...(lock && { lock }) },
    };
  }
  const fresh = await core.bridge.runPromise(
    core.localApi.readAnnotation(annotationKey, attachmentKey),
  );
  if ("failure" in fresh) {
    logger.debug("A written annotation could not be read back", {
      annotationKey,
      failure: fresh.failure,
    });
    core.bridge.runSync(invalidate(core, queryKey));
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
}

/** Publish API confirmations independently of the transport cache's lifetime. */
async function publishApiChange(
  core: CoreState,
  attachmentKey: string,
  source: LocalApiSource,
  confirmation: AnnotationConfirmation,
): Promise<boolean> {
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
  await announceReadPixels(core, previous, next);
  return true;
}

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
