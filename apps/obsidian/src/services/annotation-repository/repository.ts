// The Annotations of one Attachment, read from one Annotation Source at a time.
import type { QueryFunction, QueryKey } from "@tanstack/query-core";

import {
  annotationTypeToName,
  parseAnnotationPosition,
  parseIndexedKey,
  resolveIndexedKeyLibraryIn,
} from "@zotlit/db";
import type {
  Annotation,
  AnnotationPositionRaw,
  Attachment,
  Library,
  ZoteroDatabaseIdentity,
} from "@zotlit/db";

import { getLogger } from "@/lib/log";
import { yieldToMain } from "@/lib/yield-to-main";
import { excerptFingerprint } from "@/services/excerpt-image/contract";
import type { Held } from "@/services/query-client/service";
import { cooldownFailure } from "@/services/zotero-local-api/plain";
import type {
  LocalApiFailure,
  LocalApiSource,
} from "@/services/zotero-local-api/service";
import {
  libraryPath,
  readCreateResult,
} from "@/services/zotero-local-api/wire";
import { changed } from "@/services/zotero-reads/events";
import { acquireReadLease } from "@/services/zotero-reads/lease";

import { capabilityReason, editingCapabilityOf } from "./capability";
import type { EditingCapability } from "./capability";
import {
  apiState,
  demandedSource,
  invalidate,
  keysUnder,
  peekQuery,
  readHeldQuery,
  refreshZoteroDatabase,
} from "./core/bridge";
import {
  ANNOTATIONS,
  DRAFT_FIELDS,
  TEXT_FIELD_SPECS,
  freshValueOf,
  fromLocalApi,
  indexedID,
  proposedTags,
  proposedText,
  sameText,
  templateTags,
} from "./core/model";
import type {
  AnnotationConfirmation,
  AnnotationList,
  AnnotationMutation,
  AnnotationRecord,
  AnnotationRepositoryCoreDeps,
  AnnotationState,
  ConfirmedWrite,
  DatabaseAnnotationSource,
  DatabaseAnswer,
  DatabaseBatch,
  DraftField,
  DraftFields,
  GroupKind,
  GroupWrite,
  GroupWrites,
  HeldAnnotation,
  PendingProposal,
  ProposedFields,
  TagDraft,
  TextFieldDraft,
  TextSave,
  WriteAttempt,
} from "./core/model";
import {
  answerOf,
  leave,
  mutationFor,
  pendingWrites,
  savingText,
  settle,
  standingOutcome,
  takeOver,
} from "./core/outcomes";
import { CoreState } from "./core/state";
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
  HistoryJoin,
  HistoryOutcome,
  HistoryStep,
  TagHistoryStep,
} from "./history";
import { firstLockRefusal, lockOf } from "./lock";
import type { AnnotationLock, LockedVerb, LockReason } from "./lock";
import { listLocalApi, readAll } from "./reads";
import { resolvesSilently, sameStoredGeometry } from "./reconcile";
import {
  annotationTags,
  byTextField,
  colorPatch,
  createRequest,
  eraseRequest,
  geometryPatch,
  IDLE,
  isTextField,
  MAX_POSITION_LENGTH,
  mergeTags,
  noTagChange,
  tagChange,
  tagsPatch,
  TEXT_FIELDS,
  wireColor,
  writePosition,
} from "./write";
import type {
  AnnotationDraft,
  AnnotationTag,
  ConflictedWrite,
  GeometryEdit,
  GeometryInput,
  MutationState,
  TagChange,
  TextField,
  WriteConflict,
  WriteFailure,
  WriteRequest,
  WriteTarget,
} from "./write";
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

/**
 * How long after the last ask the list of an Attachment no surface holds is
 * still read again on a database change. A list asked for longer ago is let
 * go at that change instead, so a surface that reads without a hold keeps its
 * list while it keeps asking.
 */
export const UNHELD_RETENTION = Temporal.Duration.from({ minutes: 5 });

/** The partition the Zotero database answers from, keyed by Indexed Key. */
const ZOTERO_DB = "zotero-db";

/**
 * The partition the Zotero Local API answers from, keyed by the Zotero Server
 * ID and then by Indexed Key, so one server's records never stand for another's.
 */
const ZOTERO_LOCAL_API = "zotero-local-api";

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

/** The write failure a lock gives, with its Lock Reason. */
type LockedFailure = Extract<WriteFailure, { kind: "locked" }>;

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

/** One partition's key and the read that fills it. */
interface AnnotationPartition {
  queryKey: QueryKey;
  /** Takes the query's own signal, so an invalidation cancels the read it ran. */
  read: QueryFunction<AnnotationList>;
}

/** Why the Zotero Local API answered no list, as the query's failure. */
export class LocalApiReadFailed extends Error {
  readonly failure: LocalApiFailure;

  constructor(failure: LocalApiFailure) {
    super(`The Zotero Local API answered ${failure.kind}`);
    this.name = "LocalApiReadFailed";
    this.failure = failure;
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
 * @param attachmentKey the Attachment's Indexed Key.
 * @returns the list that stands, with the Pending Proposal of each write in
 *   flight drawn over it, or null while no read has answered for it.
 */
function read(
  core: CoreState,
  attachmentKey: string,
): Promise<AnnotationList | null> {
  core.lastAsked.set(attachmentKey, core.now());
  return readUnasked(core, attachmentKey);
}

/**
 * {@link read} for this repository's own reads, which are no ask: a list
 * read again after a database change is let go on time all the same.
 */
async function readUnasked(
  core: CoreState,
  attachmentKey: string,
): Promise<AnnotationList | null> {
  const source = demandedSource(core);
  const binding = core.databaseBindings.get(attachmentKey);
  if (
    source &&
    binding &&
    binding.verifiedGeneration !== core.databaseGeneration
  ) {
    await sourceStillBound(core, attachmentKey, source);
  }
  const { queryKey, read } = activePartition(core, attachmentKey);
  const candidate = await readHeldQuery(core, queryKey, read);
  if (candidate && canPublish(core, attachmentKey, candidate, queryKey)) {
    if (candidate.source.kind === "zotero-db") {
      adoptDatabaseSource(core, attachmentKey, candidate.source);
      coverDatabaseDeletions(core, attachmentKey, candidate);
    } else if (
      coversConfirmations(candidate, core.confirmedWrites.get(attachmentKey))
    ) {
      core.confirmedWrites.delete(attachmentKey);
    }
    const superseded = core.publishedLists.get(attachmentKey);
    core.publishedLists.set(attachmentKey, candidate);
    core.publishedStatuses.set(
      attachmentKey,
      peekQuery<AnnotationList>(core, queryKey)?.status ?? "fresh",
    );
    reconcilePublishedDrafts(core, queryKey, attachmentKey, candidate);
    await announceReadPixels(core, superseded, candidate);
    return drawn(core, attachmentKey, candidate);
  }
  return published(core, attachmentKey)?.value ?? null;
}

/**
 * Keeps the lists of these Attachments published while a surface shows
 * them: a database change reads them again, and a write finds their
 * records. Disposing the hold lets each list go once no other surface holds
 * it, and the next surface that holds it again gets a fresh read.
 *
 * @param attachmentKeys the Attachments' Indexed Keys.
 */
function hold(core: CoreState, attachmentKeys: Iterable<string>): Disposable {
  const held = [...new Set(attachmentKeys)];
  for (const attachmentKey of held) {
    core.holds.set(attachmentKey, (core.holds.get(attachmentKey) ?? 0) + 1);
  }
  let released = false;
  return {
    [Symbol.dispose]: () => {
      if (released) return;
      released = true;
      for (const attachmentKey of held) {
        const left = (core.holds.get(attachmentKey) ?? 1) - 1;
        if (left > 0) {
          core.holds.set(attachmentKey, left);
          continue;
        }
        core.holds.delete(attachmentKey);
        // A surface that reads with no hold of its own may still show the
        // list; the announcement is its word to read it again.
        if (letGo(core, attachmentKey)) {
          core.publish({ _tag: "annotations-changed", attachmentKey });
        }
      }
    },
  };
}

/**
 * Drops the list of an Attachment no surface holds, with what this
 * repository kept beside it, so its next read is a fresh one. A list that
 * work in progress still stands on — an Annotation Draft, a write, an open
 * Annotation History — stays until that work ends.
 *
 * @returns whether a list was let go that a reader may show or wait for.
 */
function letGo(core: CoreState, attachmentKey: string): boolean {
  if (core.holds.has(attachmentKey) || inUse(core, attachmentKey)) return false;
  core.lastAsked.delete(attachmentKey);
  // A read still running publishes nothing once its query goes, so its
  // readers are told too.
  const reading = attachmentsHeld(core, [ANNOTATIONS]).includes(attachmentKey);
  core.queries.client.removeQueries({
    queryKey: [ANNOTATIONS],
    predicate: ({ queryKey }) => queryKey.at(-1) === attachmentKey,
  });
  const published = core.publishedLists.delete(attachmentKey);
  core.publishedStatuses.delete(attachmentKey);
  core.locks.delete(attachmentKey);
  core.databaseBindings.delete(attachmentKey);
  core.lastCapability.delete(attachmentKey);
  for (const completeID of core.completeKeys.keys()) {
    if (completeID.endsWith(indexedID("", attachmentKey))) {
      core.completeKeys.delete(completeID);
    }
  }
  logger.debug("Annotation list no surface holds was dropped", {
    attachmentKey,
  });
  return published || reading;
}

/**
 * Whether an Attachment's list stands for a surface: one holds it, work in
 * progress stands on it, or a caller asked for it within
 * {@link UNHELD_RETENTION}.
 */
function wanted(core: CoreState, attachmentKey: string): boolean {
  const asked = core.lastAsked.get(attachmentKey);
  return (
    core.holds.has(attachmentKey) ||
    inUse(core, attachmentKey) ||
    (asked !== undefined &&
      Temporal.Instant.compare(core.now(), asked.add(UNHELD_RETENTION)) < 0)
  );
}

/** Whether work in progress still stands on an Attachment's list. */
function inUse(core: CoreState, attachmentKey: string): boolean {
  if (
    core.histories.has(attachmentKey) ||
    core.writesInFlight.has(attachmentKey) ||
    core.refreshes.has(attachmentKey) ||
    core.steppingAttachments.has(attachmentKey) ||
    core.confirmedWrites.has(attachmentKey)
  )
    return true;
  for (const drafts of Object.values(core.drafts)) {
    for (const draft of drafts.values()) {
      if (draft.attachmentKey === attachmentKey) return true;
    }
  }
  return (core.publishedLists.get(attachmentKey)?.annotations ?? []).some(
    ({ key }) => core.outcomes.has(key) || pendingWrites(core, key).length > 0,
  );
}

/**
 * Revalidates one Attachment through its active source. Concurrent surfaces
 * join the same operation, while the Held Read keeps their published list.
 */
function refresh(
  core: CoreState,
  attachmentKey: string,
): Promise<AnnotationList | null> {
  const running = core.refreshes.get(attachmentKey);
  if (running) return running;

  const refreshing = revalidate(core, attachmentKey)
    .catch((error: unknown) => {
      logger.warn("Failed to refresh an Attachment's annotations", {
        attachmentKey,
        error,
      });
      if (core.publishedLists.has(attachmentKey)) {
        core.publishedStatuses.set(attachmentKey, "failed");
      }
      return peek(core, attachmentKey)?.value ?? null;
    })
    .finally(() => {
      if (core.refreshes.get(attachmentKey) === refreshing) {
        core.refreshes.delete(attachmentKey);
      }
    });
  core.refreshes.set(attachmentKey, refreshing);
  return refreshing;
}

/** Probes source availability, refreshes the active adapter, then reads it. */
async function revalidate(
  core: CoreState,
  attachmentKey: string,
): Promise<AnnotationList | null> {
  await core.bridge.runPromise(core.localApi.probe);
  if (compatibleApiSource(core, attachmentKey) === null) {
    // A failed refresh keeps the previous database serving, so the read
    // below still answers; a database that cannot serve fails that read.
    await refreshZoteroDatabase(core).catch((error: unknown) => {
      logger.debug("The Zotero database refresh failed", { error });
    });
  }
  const { queryKey } = activePartition(core, attachmentKey);
  core.publish({ _tag: "annotations-changed", attachmentKey });
  invalidate(core, queryKey);
  const value = await read(core, attachmentKey);
  const status = peekQuery<AnnotationList>(core, queryKey)?.status;
  if (value && status === "failed") {
    core.publishedStatuses.set(attachmentKey, status);
  }
  return value;
}

/**
 * What `attachmentKey` holds right now, for a caller that cannot wait — a
 * surface redrawing synchronously. The Held Read travels whole, so the caller
 * can tell a list that stands from one a refresh has already superseded.
 *
 * @returns null while no read has answered for the Attachment.
 */
function peek(
  core: CoreState,
  attachmentKey: string,
): Held<AnnotationList> | null {
  return published(core, attachmentKey);
}

/**
 * What a surface may do to one Attachment's Annotations: the Capability
 * Probe, plus what the write path learned about this Attachment's library and
 * about the authorization gesture in flight.
 *
 * @param attachmentKey the Attachment's Indexed Key.
 */
function capabilityFor(
  core: CoreState,
  attachmentKey: string,
): EditingCapability {
  return editingCapability(core, attachmentKey);
}

/**
 * What the session itself may do, with no Attachment in hand — what the
 * "Zotero editing" settings row shows. A library Zotero refuses writes to is
 * a fact about one Attachment and has no place here.
 */
function capability(core: CoreState): EditingCapability {
  return editingCapability(core, null);
}

/**
 * Re-check Zotero now, from a user gesture: the Editing Capability
 * affordance's click, and a keystroke that met a block. A probe that changes
 * anything announces itself through `capability-changed`.
 */
async function probe(core: CoreState): Promise<void> {
  await core.bridge.runPromise(core.localApi.probe);
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

/** The active Zotero database's shared draft of one field of an Annotation. */
function draftFor<F extends DraftField>(
  core: CoreState,
  field: F,
  annotationKey: string,
): DraftFields[F] | null {
  const serverID =
    demandedSource(core)?.serverID ??
    core.draftSources[field].get(annotationKey);
  return serverID
    ? (core.drafts[field].get(indexedID(serverID, annotationKey)) ?? null)
    : null;
}

/** Every field's draft on one Annotation, in any Zotero database. */
function draftsOn(
  core: CoreState,
  annotationKey: string,
): (TextFieldDraft | TagDraft)[] {
  return Object.values(core.drafts).flatMap((drafts) =>
    [...drafts.values()].filter(
      (draft) => draft.annotationKey === annotationKey,
    ),
  );
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
 * One Editing Capability, logged at debug where it differs from the last
 * value this consumer was given for the same subject — every read at trace,
 * every change at debug, so a session's capability history is in the log
 * without one line per redraw.
 *
 * @param attachmentKey the Attachment, or null for the session itself.
 */
function editingCapability(
  core: CoreState,
  attachmentKey: string | null,
): EditingCapability {
  const capability =
    attachmentKey !== null &&
    demandedSource(core) &&
    !compatibleApiSource(core, attachmentKey)
      ? ({ kind: "read-only", reason: "server-changed" } as const)
      : editingCapabilityOf(
          apiState(core),
          core.bridge.runSync(core.localApi.writeStateFor(attachmentKey)),
          core.now,
        );
  const described = describeCapability(capability);
  if (core.lastCapability.get(attachmentKey) === described) {
    logger.trace("Editing capability read", { attachmentKey, capability });
    return capability;
  }
  core.lastCapability.set(attachmentKey, described);
  logger.debug("Editing capability changed", { attachmentKey, capability });
  return capability;
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
  const expectedServerID = demandedSource(core)?.serverID ?? null;
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
  if ((demandedSource(core)?.serverID ?? null) !== command.expectedServerID) {
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
      if (!demandedSource(core)) {
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
 * Announce every Annotation a read found moved, so an Excerpt Image made from
 * the record that stood before it is replaced rather than shown.
 *
 * An edit saved in Zotero itself — a crop resize, an ink colour — reaches this
 * repository through freshness invalidation and the read after it, where no
 * write of its own says so, and this is where that read's movement is found.
 * The comparison is the canonical pixel fingerprint against the list that
 * stood before the read answered, so a read that answers the same pixels — a
 * source switch, or Zotero echoing a colour the user picked — says nothing,
 * and a second read of a list already published says nothing either.
 *
 * The first read of a session has no such list: what stands before it then is
 * the image this device persists for the Annotation, which is what the read is
 * compared against instead. An Annotation this device never cached has no
 * baseline and says nothing here, exactly as it is replaced nowhere: whether an
 * image is held is the consumer's own stored-outcome gate to answer, and a
 * record nothing stands for stays on demand.
 */
async function announceReadPixels(
  core: CoreState,
  superseded: AnnotationList | undefined,
  candidate: AnnotationList,
): Promise<void> {
  const stood = superseded
    ? fingerprintMap(superseded)
    : await persistedFingerprints(core, candidate);
  for (const record of candidate.annotations) {
    const fingerprint = stood.get(record.key);
    if (fingerprint === undefined || fingerprint === excerptFingerprint(record))
      continue;
    core.publish({
      _tag: "excerpt-pixels-changed",
      record,
      source: candidate.source,
    });
  }
}

/**
 * The pixels this device's persisted Excerpt Image of each of one Attachment's
 * Annotations was made from, as the baseline a session's first read is
 * compared against. An Annotation this device never cached answers nothing, so
 * it stays on demand.
 */
async function persistedFingerprints(
  core: CoreState,
  candidate: AnnotationList,
): Promise<ReadonlyMap<string, string>> {
  const persisted = core.persistedExcerpt;
  if (!persisted) return new Map();
  const stood = await Promise.all(
    candidate.annotations.map(async (record) => {
      const fingerprint = await persisted(record, candidate.source).catch(
        (error: unknown) => {
          logger.debug("A persisted excerpt could not be read", {
            annotationKey: record.key,
            error,
          });
          return null;
        },
      );
      return [record.key, fingerprint] as const;
    }),
  );
  return new Map(
    stood.filter(
      (entry): entry is readonly [string, string] => entry[1] !== null,
    ),
  );
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
    invalidate(core, queryKey);
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

/** The repository owns the records visible to readers and write commands. */
function holding(
  core: CoreState,
  annotationKey: string,
): HeldAnnotation | null {
  const source = demandedSource(core);
  for (const [attachmentKey, list] of core.publishedLists) {
    if (
      source
        ? list.source.kind !== "zotero-local-api" ||
          !sameApiSource(core, attachmentKey, list.source)
        : list.source.kind !== "zotero-db"
    )
      continue;
    const record = list.annotations.find(
      (record) => record.key === annotationKey,
    );
    if (record)
      return {
        attachmentKey,
        record,
        queryKey: source
          ? [ANNOTATIONS, ZOTERO_LOCAL_API, source.serverID, attachmentKey]
          : [ANNOTATIONS, ZOTERO_DB, core.databaseGeneration, attachmentKey],
      };
  }
  return null;
}

/** Verify the binding and complete the first API handoff before a write. */
async function prepareCollection(
  core: CoreState,
  attachmentKey: string,
  source: LocalApiSource,
): Promise<boolean> {
  if (!(await sourceStillBound(core, attachmentKey, source))) return false;
  if (
    core.publishedLists.get(attachmentKey)?.source.kind !== "zotero-local-api"
  ) {
    await read(core, attachmentKey);
  }
  const list = core.publishedLists.get(attachmentKey);
  return (
    list?.source.kind === "zotero-local-api" &&
    sameApiSource(core, attachmentKey, list.source)
  );
}

/** Locate the Annotation independently of the source's write readiness. */
function attachmentHolding(
  core: CoreState,
  annotationKey: string,
): string | undefined {
  return [...core.publishedLists].find(([, list]) =>
    list.annotations.some((record) => record.key === annotationKey),
  )?.[0];
}

async function prepareWrite(
  core: CoreState,
  annotationKey: string,
): Promise<HeldAnnotation | null | "server-changed"> {
  const source = demandedSource(core);
  if (!source) return holding(core, annotationKey);
  const attachmentKey = attachmentHolding(core, annotationKey);
  if (attachmentKey) {
    if (!(await sourceStillBound(core, attachmentKey, source)))
      return "server-changed";
    if (
      core.publishedLists.get(attachmentKey)?.source.kind !== "zotero-local-api"
    ) {
      await read(core, attachmentKey);
    }
  }
  return holding(core, annotationKey);
}

/**
 * One Attachment's list is superseded: it goes, and the Attachment is
 * announced. The only signal a consumer replaces a list on.
 *
 * @param queryKey the partition key the caller already holds; the active
 *   partition's own key where it does not.
 */
function dropAttachment(
  core: CoreState,
  attachmentKey: string,
  queryKey?: QueryKey,
): void {
  invalidate(core, queryKey ?? activePartition(core, attachmentKey).queryKey);
  core.publish({ _tag: "annotations-changed", attachmentKey });
}

function setDraft<F extends DraftField>(
  core: CoreState,
  field: F,
  draft: DraftFields[F],
): void {
  core.drafts[field].set(indexedID(draft.serverID, draft.annotationKey), draft);
  core.draftSources[field].set(draft.annotationKey, draft.serverID);
  core.publish({
    _tag: "annotation-changed",
    annotationKey: draft.annotationKey,
  });
}

/** Drop one field's draft of an Annotation, with its autosave. */
function dropDraft(
  core: CoreState,
  field: DraftField,
  draft: TextFieldDraft | TagDraft,
): void {
  const { serverID, annotationKey } = draft;
  if (!core.drafts[field].delete(indexedID(serverID, annotationKey))) return;
  if (core.draftSources[field].get(annotationKey) === serverID) {
    core.draftSources[field].delete(annotationKey);
  }
  if (isTextField(field)) cancelTextSave(core, field, draft);
  core.publish({ _tag: "annotation-changed", annotationKey });
}

/** Drop every field's draft of an Annotation that {@link draftFor} finds. */
function dropDrafts(core: CoreState, annotationKey: string): void {
  for (const field of DRAFT_FIELDS) {
    const draft = draftFor(core, field, annotationKey);
    if (draft) dropDraft(core, field, draft);
  }
}

function textSave(core: CoreState, field: TextField, id: string): TextSave {
  const saves = core.textSaves[field];
  const standing = saves.get(id);
  if (standing) return standing;
  const save: TextSave = { idleTimer: null, burstTimer: null };
  saves.set(id, save);
  return save;
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

function clearTextTimers(core: CoreState, save: TextSave): void {
  if (save.idleTimer !== null) window.clearTimeout(save.idleTimer);
  if (save.burstTimer !== null) window.clearTimeout(save.burstTimer);
  save.idleTimer = null;
  save.burstTimer = null;
}

function cancelTextSave(
  core: CoreState,
  field: TextField,
  {
    serverID,
    annotationKey,
  }: Pick<TextFieldDraft, "serverID" | "annotationKey">,
): void {
  const id = indexedID(serverID, annotationKey);
  const save = core.textSaves[field].get(id);
  if (!save) return;
  clearTextTimers(core, save);
  core.textSaves[field].delete(id);
}

function cancelAllTextSaves(core: CoreState): void {
  for (const saves of Object.values(core.textSaves)) {
    for (const save of saves.values()) clearTextTimers(core, save);
  }
}

/** Reconcile drafts only against a complete read from their own database. */
function reconcileDrafts(
  core: CoreState,
  serverID: string,
  attachmentKey: string,
  annotations: readonly AnnotationRecord[],
): void {
  const records = new Map(annotations.map((record) => [record.key, record]));
  const completeID = indexedID(serverID, attachmentKey);
  const before = core.completeKeys.get(completeID);
  core.completeKeys.set(completeID, new Set(records.keys()));
  // Gone is what the last complete read showed, or a draft stands on, and
  // this one no longer answers.
  const gone = new Set(
    [
      ...(before ?? []),
      ...Object.values(core.drafts)
        .flatMap((drafts) => [...drafts.values()])
        .filter(
          (draft) =>
            draft.serverID === serverID &&
            draft.attachmentKey === attachmentKey,
        )
        .map((draft) => draft.annotationKey),
    ].filter((key) => !records.has(key)),
  );
  for (const key of records.keys()) core.gone.delete(key);
  for (const key of gone) core.gone.add(key);
  // Deletion confirmed in Zotero discards the tag draft with the text
  // drafts; the gone Annotation is announced below.
  for (const draft of core.drafts.tags.values()) {
    if (
      draft.serverID !== serverID ||
      draft.attachmentKey !== attachmentKey ||
      records.has(draft.annotationKey)
    )
      continue;
    dropDraft(core, "tags", draft);
  }
  for (const field of TEXT_FIELDS) {
    reconcileTextDrafts(core, field, { serverID, attachmentKey, records });
  }
  // What a write left on an Annotation goes with it, and every surface
  // still drawing it hears that it is gone, with a draft or without.
  for (const key of gone) {
    core.outcomes.delete(key);
    core.publish({ _tag: "annotation-changed", annotationKey: key });
  }
}

/**
 * Reconcile one text field's drafts in one Attachment against a complete
 * read: a value Zotero already holds ends the draft, an untouched draft
 * follows Zotero, and a changed value under typed text is a Write Conflict.
 */
function reconcileTextDrafts(
  core: CoreState,
  field: TextField,
  {
    serverID,
    attachmentKey,
    records,
  }: {
    serverID: string;
    attachmentKey: string;
    records: ReadonlyMap<string, AnnotationRecord>;
  },
): void {
  const drafts = core.drafts[field];
  for (const draft of drafts.values()) {
    if (draft.serverID !== serverID || draft.attachmentKey !== attachmentKey) {
      continue;
    }
    const record = records.get(draft.annotationKey);
    if (!record) {
      dropDraft(core, field, draft);
      continue;
    }
    const fresh = TEXT_FIELD_SPECS[field].valueOf(record) ?? "";
    if (draft.state.kind === "pending") {
      if (
        pendingWrites(core, draft.annotationKey).some(
          (mutation) =>
            mutation.options.mutationKey?.[2] === field &&
            sameText(fresh, proposedText(field, mutation)),
        )
      ) {
        drafts.set(indexedID(serverID, draft.annotationKey), {
          ...draft,
          baseline: fresh,
        });
        core.publish({
          _tag: "annotation-changed",
          annotationKey: draft.annotationKey,
        });
      }
      continue;
    }
    if (sameText(fresh, draft.text)) {
      dropDraft(core, field, draft);
      continue;
    }
    if (sameText(fresh, draft.baseline)) continue;
    if (sameText(draft.text, draft.baseline)) {
      drafts.set(indexedID(serverID, draft.annotationKey), {
        ...draft,
        baseline: fresh,
        text: fresh,
        state: { kind: "editing" },
      });
      core.publish({
        _tag: "annotation-changed",
        annotationKey: draft.annotationKey,
      });
      continue;
    }
    const conflict: MutationState = {
      kind: "conflict",
      conflict: { write: field, attempted: draft.text, fresh },
    };
    settle(core, draft.annotationKey, field, conflict);
    drafts.set(indexedID(draft.serverID, draft.annotationKey), {
      ...draft,
      state: { kind: "conflict", fresh },
    });
    core.publish({
      _tag: "annotation-changed",
      annotationKey: draft.annotationKey,
    });
    core.publish({
      _tag: "write-conflict",
      annotationKey: draft.annotationKey,
      attachmentKey,
    });
  }
}

/** Reconcile only a complete result Query Core accepted for publication. */
function reconcilePublishedDrafts(
  core: CoreState,
  queryKey: QueryKey,
  attachmentKey: string,
  list: AnnotationList | null,
): void {
  if (!list) return;
  const held = peekQuery<AnnotationList>(core, queryKey);
  if (held?.status !== "fresh" || held.value !== list) return;
  const serverID =
    list.source.kind === "zotero-local-api"
      ? list.source.serverID
      : list.source.database.serverID;
  if (serverID === null) return;
  reconcileDrafts(core, serverID, attachmentKey, list.annotations);
}

/**
 * The partition the active Annotation Source answers from — the one place a
 * source is chosen. {@link read} and {@link peek} never name one, and a
 * result already carries the one that answered it.
 *
 * The choice is made once per ask and the whole list comes from it, which is
 * what makes the source atomic per Attachment. A Zotero that stops answering
 * changes what this returns, and the change is announced rather than folded
 * into the list in flight.
 */
function activePartition(
  core: CoreState,
  attachmentKey: string,
): AnnotationPartition {
  const source = compatibleApiSource(core, attachmentKey);
  if (source) {
    return {
      queryKey: [ANNOTATIONS, ZOTERO_LOCAL_API, source.serverID, attachmentKey],
      read: ({ signal }) =>
        readFromLocalApi(core, source, attachmentKey, signal),
    };
  }
  return {
    queryKey: [ANNOTATIONS, ZOTERO_DB, core.databaseGeneration, attachmentKey],
    read: () => readFromDatabase(core, attachmentKey),
  };
}

/**
 * @throws {LocalApiReadFailed} where the Zotero Local API did not answer the
 *   list. The client has already stood its session down by then, so the
 *   Attachment's next ask lands on the source that can answer.
 */
async function readFromLocalApi(
  core: CoreState,
  source: LocalApiSource,
  attachmentKey: string,
  signal: AbortSignal,
): Promise<AnnotationList> {
  const [result] = await Promise.all([
    listLocalApi(
      { bridge: core.bridge, api: core.localApi },
      attachmentKey,
      signal,
    ),
    readLocks(core, attachmentKey),
  ]);
  if ("failure" in result) throw new LocalApiReadFailed(result.failure);
  return { source, annotations: result.value.map(fromLocalApi) };
}

/**
 * Read the locks of one Attachment's Annotations from the Zotero database
 * into {@link locks}, beside a Zotero Local API list, whose item JSON
 * carries no lock facts. The list itself stays wholly the Local API's (ADR
 * 0034). A database that cannot be read keeps the locks the last read gave,
 * so only an Attachment never read has no lock.
 *
 * @returns whether any lock of the Attachment moved.
 * @see apps/obsidian/docs/adr/0067-annotation-locks-come-from-the-zotero-database.md
 */
async function readLocks(
  core: CoreState,
  attachmentKey: string,
): Promise<boolean> {
  const generation = core.databaseGeneration;
  let annotations: readonly AnnotationRecord[];
  try {
    const { found } = await databaseRead(core, attachmentKey);
    annotations = toRecords(attachmentKey, found);
  } catch (error) {
    logger.debug("No lock facts could be read from the Zotero database", {
      attachmentKey,
      error,
    });
    return false;
  }
  // A read a database change overtook holds the old locks; the change reads
  // them again.
  if (generation !== core.databaseGeneration) return false;
  return keepLocks(core, attachmentKey, annotations);
}

/**
 * Keep the locks one database read gave an Attachment's Annotations.
 *
 * @returns whether any of them moved.
 */
function keepLocks(
  core: CoreState,
  attachmentKey: string,
  annotations: readonly AnnotationRecord[],
): boolean {
  const locks = new Map(
    annotations.flatMap(({ key, lock }) =>
      lock ? [[key, lock] as const] : [],
    ),
  );
  const held = core.locks.get(attachmentKey) ?? new Map();
  core.locks.set(attachmentKey, locks);
  return (
    held.size !== locks.size ||
    [...locks].some(([key, lock]) => held.get(key)?.reason !== lock.reason)
  );
}

/**
 * A refreshed Zotero database may lock an Annotation a Zotero Local API list
 * holds — Zotero imported it from the PDF file since the list was read — or
 * unlock one. The list is not read again from Zotero: only the locks move,
 * and each Attachment whose locks moved is announced, so its surfaces draw
 * the list again with the new locks.
 */
async function refreshLocks(core: CoreState): Promise<void> {
  for (const attachmentKey of core.locks.keys()) {
    // The list of the Zotero DB source is read again whole, and that read
    // keeps its locks.
    if (core.publishedLists.get(attachmentKey)?.source.kind === "zotero-db")
      continue;
    if (!(await readLocks(core, attachmentKey))) continue;
    logger.debug("A database refresh moved the locks of an Attachment", {
      attachmentKey,
    });
    core.publish({ _tag: "annotations-changed", attachmentKey });
  }
}

async function readFromDatabase(
  core: CoreState,
  attachmentKey: string,
): Promise<AnnotationList> {
  const generation = core.databaseGeneration;
  const { found, libraries, database } = await databaseRead(
    core,
    attachmentKey,
  );
  const annotations = toRecords(attachmentKey, found);
  const source = databaseAnnotationSource(attachmentKey, libraries, database);
  if (generation === core.databaseGeneration)
    keepLocks(core, attachmentKey, annotations);
  logger.debug("Annotations read from the Zotero database", {
    attachmentKey,
    annotations: annotations.length,
  });
  return { source, annotations };
}

/**
 * One Attachment's rows from the Zotero database, read in the batch that
 * every database read asked in the same task joins: one lease and one query
 * for all of them, whatever number of Attachments a view shows.
 */
function databaseRead(
  core: CoreState,
  attachmentKey: string,
): Promise<DatabaseAnswer> {
  const waiting = Promise.withResolvers<DatabaseAnswer>();
  let batch = core.databaseBatch;
  // A read asked after a database change leaves the batch the change
  // overtook, so it takes a lease on the database that stands now.
  if (batch?.generation !== core.databaseGeneration) {
    const gathering: DatabaseBatch = {
      generation: core.databaseGeneration,
      readers: new Map(),
    };
    core.databaseBatch = batch = gathering;
    void yieldToMain().then(() => flushDatabaseBatch(core, gathering));
  }
  const readers = batch.readers.get(attachmentKey) ?? [];
  readers.push(waiting);
  batch.readers.set(attachmentKey, readers);
  return waiting.promise;
}

async function flushDatabaseBatch(
  core: CoreState,
  { readers: batch }: DatabaseBatch,
): Promise<void> {
  if (core.databaseBatch?.readers === batch) core.databaseBatch = null;
  const attachmentKeys = [...batch.keys()];
  try {
    await using lease = await acquireReadLease(core.db, core.bridge);
    const [entries, libraries, database] = await readAll(core.bridge, [
      lease.reads.AnnotationsOfAttachments({ attachmentKeys }),
      lease.reads.Libraries({}),
      lease.reads.DatabaseIdentity({}),
    ]);
    logger.debug("Annotations batch read from the Zotero database", {
      attachments: attachmentKeys.length,
    });
    for (const found of entries) {
      for (const { resolve } of batch.get(found.attachmentKey) ?? []) {
        resolve({ found, libraries, database });
      }
    }
  } catch (error) {
    for (const readers of batch.values()) {
      for (const { reject } of readers) reject(error);
    }
  }
}

function adoptDatabaseSource(
  core: CoreState,
  attachmentKey: string,
  source: DatabaseAnnotationSource,
): void {
  const binding = core.databaseBindings.get(attachmentKey);
  const previous = binding?.source;
  const previousServerID = previous?.database.serverID;
  const revalidated =
    binding !== undefined &&
    binding.verifiedGeneration !== core.databaseGeneration;
  core.databaseBindings.set(attachmentKey, {
    source,
    verifiedGeneration: core.databaseGeneration,
  });
  if (
    previousServerID !== undefined &&
    previousServerID !== source.database.serverID
  ) {
    for (const field of DRAFT_FIELDS) {
      const sources = core.draftSources[field];
      for (const draft of core.drafts[field].values()) {
        if (
          draft.attachmentKey === attachmentKey &&
          draft.serverID !== source.database.serverID &&
          sources.get(draft.annotationKey) === draft.serverID
        ) {
          sources.delete(draft.annotationKey);
          if (isTextField(field)) {
            cancelTextSave(core, field, draft);
          }
          core.publish({
            _tag: "annotation-changed",
            annotationKey: draft.annotationKey,
          });
        }
      }
    }
    for (const { key } of core.publishedLists.get(attachmentKey)?.annotations ??
      []) {
      if (core.outcomes.delete(key)) {
        core.publish({ _tag: "annotation-changed", annotationKey: key });
      }
    }
    core.confirmedWrites.delete(attachmentKey);
  }
  if (revalidated || !databaseSourcesEqual(previous, source)) {
    queueMicrotask(() => {
      core.publish({ _tag: "capability-changed" });
      if (compatibleApiSource(core, attachmentKey)) {
        core.publish({ _tag: "annotations-changed", attachmentKey });
      }
    });
  }
}

/**
 * What the Zotero Local API answers has moved: another capability, another
 * Zotero database, or the Companion's Freshness Signal saying the library
 * changed. Its whole partition goes, and every Attachment either partition
 * holds is announced — a surface reading from the Zotero DB is the one a
 * switch to the Zotero Local API most concerns.
 */
function sourceMoved(core: CoreState): void {
  invalidate(core, [ANNOTATIONS, ZOTERO_LOCAL_API]);
  const held = attachmentsHeld(core, [ANNOTATIONS]);
  const source = demandedSource(core);
  logger.debug("The Zotero Local API source moved", {
    attachments: held.length,
    source,
  });
  for (const attachmentKey of held) {
    core.publish({ _tag: "annotations-changed", attachmentKey });
  }
  rereadSuperseded(core, held);
}

/**
 * Every Attachment one prefix holds a list for. Both partitions key by
 * Indexed Key last — the Zotero Local API one behind its server id — so the
 * last element names the Attachment whichever source answered.
 */
function attachmentsHeld(core: CoreState, prefix: QueryKey): string[] {
  const keys = keysUnder(core, prefix)
    .map((queryKey) => queryKey.at(-1))
    .filter((key) => typeof key === "string");
  return [...new Set(keys)];
}

/**
 * A refreshed database replaces every row the partition held, so the whole
 * partition goes rather than the rows a comparison would call changed.
 */
function dropDatabasePartition(core: CoreState): void {
  core.databaseGeneration += 1;
  const prefix = [ANNOTATIONS, ZOTERO_DB];
  const held = attachmentsHeld(core, prefix);
  invalidate(core, prefix);
  invalidate(core, [ANNOTATIONS, ZOTERO_LOCAL_API]);
  logger.debug("Zotero database annotation partition dropped", {
    attachments: held.length,
  });
  for (const attachmentKey of held) {
    core.publish({ _tag: "annotations-changed", attachmentKey });
  }
  rereadSuperseded(core, held);
}

/**
 * Read every Attachment a source change superseded again, so the movement it
 * carried is found and announced whether or not a surface is mounted to ask:
 * an edit saved in Zotero itself reaches the repository through this change
 * and the read after it, and a device that holds an Excerpt Image of the
 * Annotation must replace it with no Annotation View, reader, or binding on
 * screen. The lists this repository still stands for are read too, because a
 * Held Read the query client collected leaves the standing list behind.
 *
 * Only a list a surface still wants is read again: one a surface holds, one
 * work in progress stands on, or one a caller asked for within
 * {@link UNHELD_RETENTION}. Every other list is let go here, so a view over a
 * whole Library costs nothing once it closes. Its next read compares against
 * the image this device persists, as a session's first read does.
 *
 * Whether this device holds an image for an Annotation is not this
 * repository's to know: the consumer resolves that against its own store, so
 * one this device never cached stays on demand.
 */
function rereadSuperseded(core: CoreState, announced: readonly string[]): void {
  for (const attachmentKey of new Set([
    ...announced,
    ...core.publishedLists.keys(),
  ])) {
    if (!wanted(core, attachmentKey)) {
      letGo(core, attachmentKey);
      continue;
    }
    void readUnasked(core, attachmentKey).catch((error: unknown) => {
      logger.debug("A superseded Attachment was not read again", {
        attachmentKey,
        error,
      });
    });
  }
}

/** The published list as surfaces draw it: with every Pending Proposal. */
function published(
  core: CoreState,
  attachmentKey: string,
): Held<AnnotationList> | null {
  const confirmed = core.publishedLists.get(attachmentKey);
  const value = confirmed && drawn(core, attachmentKey, confirmed);
  return value
    ? {
        value,
        status: core.publishedStatuses.get(attachmentKey) ?? "fresh",
        settled: Promise.resolve(value),
      }
    : null;
}

/**
 * One confirmed list with the Pending Proposal of every write in flight on
 * its Annotations drawn over it, the later write's field over the earlier's.
 * A proposal is drawn only over the list of the Zotero database it was sent
 * to. The list itself is answered while nothing is proposed.
 */
function drawn(
  core: CoreState,
  attachmentKey: string,
  list: AnnotationList,
): AnnotationList {
  return withProposals(
    core,
    attachmentKey,
    withLocks(core, attachmentKey, list),
  );
}

/** One list with the locks the Zotero database last gave its Annotations. */
function withLocks(
  core: CoreState,
  attachmentKey: string,
  list: AnnotationList,
): AnnotationList {
  const locks = core.locks.get(attachmentKey);
  if (!locks) return list;
  const joined = core.lockedLists.get(list);
  if (joined?.locks === locks) return joined.list;
  let moved = false;
  const annotations = list.annotations.map((record) => {
    const lock = locks.get(record.key) ?? null;
    if (record.lock?.reason === lock?.reason) return record;
    moved = true;
    return { ...record, lock };
  });
  const drawn = moved ? { ...list, annotations } : list;
  core.lockedLists.set(list, { locks, list: drawn });
  return drawn;
}

function withProposals(
  core: CoreState,
  attachmentKey: string,
  list: AnnotationList,
): AnnotationList {
  if (list.source.kind !== "zotero-local-api") return list;
  const { serverID } = list.source;
  const proposed = new Map<string, ProposedFields>();
  for (const mutation of core.queries.client
    .getMutationCache()
    .findAll({ mutationKey: [ANNOTATIONS], status: "pending" })) {
    const proposal = (mutation as AnnotationMutation).state.variables;
    if (
      !proposal ||
      proposal.attachmentKey !== attachmentKey ||
      proposal.serverID !== serverID
    )
      continue;
    const { annotationKey, fields } = proposal;
    proposed.set(annotationKey, {
      ...proposed.get(annotationKey),
      ...fields,
    });
  }
  if (proposed.size === 0) return list;
  return {
    ...list,
    annotations: list.annotations.map((record) => {
      const fields = proposed.get(record.key);
      return fields ? { ...record, ...fields } : record;
    }),
  };
}

function compatibleApiSource(
  core: CoreState,
  attachmentKey: string | null,
): LocalApiSource | null {
  const api = demandedSource(core);
  if (!api) return null;
  const sources =
    attachmentKey === null
      ? core.databaseBindings.values()
      : [core.databaseBindings.get(attachmentKey)].values();
  for (const binding of sources) {
    if (binding?.source.database.serverID === api.serverID) return api;
  }
  return null;
}

function sameApiSource(
  core: CoreState,
  attachmentKey: string,
  expected: LocalApiSource,
): boolean {
  return (
    compatibleApiSource(core, attachmentKey)?.serverID === expected.serverID
  );
}

/** Availability can lapse while an acknowledged write keeps its database identity. */
async function sourceStillBound(
  core: CoreState,
  attachmentKey: string,
  expected: LocalApiSource,
): Promise<boolean> {
  for (;;) {
    const state = apiState(core);
    if (
      state.kind === "available"
        ? state.source.serverID !== expected.serverID
        : state.kind === "unavailable" &&
          state.failure.kind === "server-changed"
    )
      return false;
    const binding = core.databaseBindings.get(attachmentKey);
    if (
      binding?.verifiedGeneration === core.databaseGeneration &&
      binding.source.database.serverID === expected.serverID
    )
      return true;
    const generation = core.databaseGeneration;
    const snapshot = await readFromDatabase(core, attachmentKey);
    if (generation !== core.databaseGeneration) continue;
    const { source } = snapshot;
    if (source.kind !== "zotero-db") return false;
    adoptDatabaseSource(core, attachmentKey, source);
    coverDatabaseDeletions(core, attachmentKey, snapshot);
    if (source.database.serverID !== expected.serverID) return false;
  }
}

/** A newer database snapshot can prove a confirmed record was deleted. */
function coverDatabaseDeletions(
  core: CoreState,
  attachmentKey: string,
  snapshot: AnnotationList,
): void {
  if (snapshot.source.kind !== "zotero-db") return;
  const revision = snapshot.source.libraryRevision;
  const confirmations = core.confirmedWrites.get(attachmentKey);
  if (revision === null || !confirmations) return;
  const keys = new Set(snapshot.annotations.map((record) => record.key));
  core.confirmedWrites.set(
    attachmentKey,
    confirmations.map((confirmation) => {
      if (
        confirmation.kind === "deleted" ||
        confirmation.record.version === null ||
        revision <= confirmation.record.version ||
        keys.has(confirmation.record.key)
      )
        return confirmation;
      return { kind: "deleted", annotationKey: confirmation.record.key };
    }),
  );
}

function canPublish(
  core: CoreState,
  attachmentKey: string,
  candidate: AnnotationList,
  queryKey?: QueryKey,
): boolean {
  if (candidate.source.kind === "zotero-local-api") {
    return (
      sameApiSource(core, attachmentKey, candidate.source) &&
      coversConfirmations(candidate, core.confirmedWrites.get(attachmentKey))
    );
  }
  const { source } = candidate;
  const current = core.publishedLists.get(attachmentKey);
  // Keep the write's API collection until its acknowledgement can be applied.
  // Availability can change while the request is in flight without changing
  // the database that owns its records.
  if (
    core.writesInFlight.has(attachmentKey) &&
    current?.source.kind === "zotero-local-api" &&
    current.source.serverID === source.database.serverID
  )
    return false;
  if (queryKey?.[1] === ZOTERO_DB && queryKey[2] !== core.databaseGeneration) {
    return false;
  }
  const floor = core.acknowledgedRevisions.get(databaseLibraryKey(source));
  return (
    floor === undefined ||
    (source.libraryRevision !== null && source.libraryRevision >= floor)
  );
}

function rememberAcknowledgedRevision(
  core: CoreState,
  attachmentKey: string,
  headers: Headers,
): void {
  const source = core.databaseBindings.get(attachmentKey)?.source;
  const header = headers.get("last-modified-version");
  if (!source) return;
  const key = databaseLibraryKey(source);
  const value = Number(header);
  if (
    header === null ||
    header === "" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    String(value) !== header
  ) {
    core.acknowledgedRevisions.set(key, Number.POSITIVE_INFINITY);
    return;
  }
  const held = core.acknowledgedRevisions.get(key) ?? -1;
  if (value > held) core.acknowledgedRevisions.set(key, value);
}

function databaseLibraryKey(source: DatabaseAnnotationSource): string {
  return `${source.database.serverID ?? "uninitialized"}:${source.libraryID}`;
}

function databaseSourcesEqual(
  a: DatabaseAnnotationSource | undefined,
  b: DatabaseAnnotationSource,
): boolean {
  return (
    a?.database.serverID === b.database.serverID &&
    a?.libraryID === b.libraryID &&
    a?.libraryRevision === b.libraryRevision
  );
}

/** One list's canonical pixel fingerprints, by Indexed Key. */
function fingerprintMap(list: AnnotationList): ReadonlyMap<string, string> {
  return new Map(
    list.annotations.map((record) => [record.key, excerptFingerprint(record)]),
  );
}

function coversConfirmation(
  list: AnnotationList | undefined,
  confirmation: AnnotationConfirmation | undefined,
): boolean {
  if (!confirmation) return true;
  if (!list || list.source.kind !== "zotero-local-api") return false;
  if (confirmation.kind === "deleted") {
    return !list.annotations.some(
      ({ key }) => key === confirmation.annotationKey,
    );
  }
  const candidate = list.annotations.find(
    ({ key }) => key === confirmation.record.key,
  );
  if (!candidate || candidate.version === null) return false;
  if (candidate.version > (confirmation.record.version ?? -1)) return true;
  if (candidate.version !== confirmation.record.version) return false;
  if (confirmation.kind === "created" || confirmation.kind === "observed")
    return true;
  return (
    freshValueOf(candidate, confirmation.write) ===
    freshValueOf(confirmation.record, confirmation.write)
  );
}

function coversConfirmations(
  list: AnnotationList | undefined,
  confirmations: readonly AnnotationConfirmation[] | undefined,
): boolean {
  return (
    confirmations?.every((confirmation) =>
      coversConfirmation(list, confirmation),
    ) ?? true
  );
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

/**
 * One capability as the value the change log compares by, which is the shared
 * reason plus a cooldown's own deadline: a log line per new deadline is what
 * says the rate limit was met again, where a notice counts one cooldown once.
 */
function describeCapability(capability: EditingCapability): string {
  return capability.kind === "cooldown"
    ? `cooldown:${capability.retryAfter.toString()}`
    : capabilityReason(capability);
}

function toRecords(
  attachmentKey: string,
  found: {
    readonly attachment: Attachment | null;
    readonly annotations: readonly Annotation[];
    readonly accountUserID: number | null;
  },
): readonly AnnotationRecord[] {
  const { attachment } = found;
  if (!attachment) {
    logger.debug("No Zotero attachment answers this key", { attachmentKey });
    return [];
  }
  const contentType = attachment.contentType ?? "";
  // Read with each list, so an account's first sync moves the locks too.
  const userID = found.accountUserID;
  return found.annotations.map((annotation) =>
    toRecord(annotation, { attachmentKey, contentType, userID }),
  );
}

function databaseAnnotationSource(
  attachmentKey: string,
  libraries: readonly Library[],
  database: ZoteroDatabaseIdentity,
): DatabaseAnnotationSource {
  const target = resolveIndexedKeyLibraryIn(libraries, attachmentKey);
  if (!target)
    throw new Error(
      `Cannot resolve the Annotation Library for ${attachmentKey}`,
    );
  const library = libraries.find(
    ({ libraryID }) => libraryID === target.libraryID,
  );
  return {
    kind: "zotero-db",
    database,
    libraryID: target.libraryID,
    libraryRevision: library?.clientVersion ?? null,
  };
}

function toRecord(
  annotation: Annotation,
  {
    attachmentKey,
    contentType,
    userID,
  }: { attachmentKey: string; contentType: string; userID: number | null },
): AnnotationRecord {
  return {
    key: annotation.indexedKey,
    type: annotationTypeToName(annotation.type),
    color: annotation.color,
    comment: annotation.comment,
    text: annotation.text,
    parentKey: attachmentKey,
    pageLabel: annotation.pageLabel,
    sortIndex: annotation.sortIndex,
    tags: annotation.tags,
    tagDetails: annotation.tagDetails,
    position: parseAnnotationPosition(annotation.position, contentType),
    version: annotation.version,
    lock: lockOf(annotation, userID),
    templateMetadata: {
      dateAdded: annotation.dateAdded.toString(),
      dateModified: annotation.dateModified.toString(),
      authorName: annotation.authorName,
      isExternal: annotation.isExternal,
      tags: templateTags(annotation.tagDetails),
    },
  };
}
