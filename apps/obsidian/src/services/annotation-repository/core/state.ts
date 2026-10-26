// The dependencies and the state that every part of the Annotation Repository core reads and changes.
import type { DateTime, Effect, FiberMap, FiberSet } from "effect";

import type { AnnotationHistory } from "@/services/annotation-repository/history";
import type { AnnotationLock } from "@/services/annotation-repository/lock";
import { newWriteToken } from "@/services/annotation-repository/write";
import type { MutationState } from "@/services/annotation-repository/write";
import type { Held } from "@/services/query-client/service";

import { databaseRowsResolver } from "./bridge";
import { DRAFT_FIELDS, fieldMaps } from "./model";
import type {
  AnnotationConfirmation,
  AnnotationList,
  AnnotationMutation,
  AnnotationRepositoryCoreDeps,
  DatabaseAnnotationSource,
  DraftField,
  DraftFields,
  OutcomeWrite,
} from "./model";
import type { WriteRunFailed } from "./writes";

/** The fibers the layer's Scope owns for the core. */
interface CoreFibers {
  readonly fibers: FiberSet.FiberSet;
  readonly refreshes: FiberMap.FiberMap<string, AnnotationList | null, never>;
  readonly idleSaves: FiberMap.FiberMap<string>;
  readonly burstSaves: FiberMap.FiberMap<string>;
}

/**
 * The dependencies and the state that the core's functions share.
 * Shared by the core's files until slice 15f removes the core.
 */
class CoreState {
  readonly bridge;
  readonly db;
  readonly queries;
  readonly localApi;
  readonly now;
  /**
   * The last Editing Capability each consumer was given, by Attachment and by
   * `null` for the session, so a change is logged once rather than per read.
   */
  readonly lastCapability = new Map<string | null, string>();
  /**
   * The failure or conflict a settled write left standing on each Annotation,
   * by Indexed Key and then by the write's field, oldest first. A failure
   * stands until the next write on the Annotation; a conflict stands until the
   * next write of its own field or a dismissal, so a comment conflict and a
   * later tag save stand side by side. A write in flight is read from the
   * mutation cache instead, so an Annotation that is idle has no entry.
   */
  readonly outcomes = new Map<string, Map<OutcomeWrite, MutationState>>();
  /** The pending state each write in the mutation cache shows while it stands. */
  readonly pendingStates = new WeakMap<AnnotationMutation, MutationState>();
  /** Every Annotation a complete read confirmed gone, by Indexed Key. */
  readonly gone = new Set<string>();
  /**
   * The keys the last complete read of each Attachment answered, by the
   * database it came from, which the next one is compared against.
   */
  readonly completeKeys = new Map<string, ReadonlySet<string>>();
  /** Annotation Drafts, by field and then by Zotero database and Annotation. */
  readonly drafts = fieldMaps<DraftField, DraftFields>(DRAFT_FIELDS);
  /**
   * The Zotero database each field's draft of an Annotation stands in, by
   * field and then by Indexed Key, read while no Local API source is active.
   */
  readonly draftSources = fieldMaps<DraftField, Record<DraftField, string>>(
    DRAFT_FIELDS,
  );
  /**
   * The autosave timers of the text drafts, by text field and the draft's
   * key: the idle timer, which each keystroke starts again, and the burst
   * timer, which caps a run of typing. A timer that comes due leaves its map.
   */
  readonly idleSaves;
  readonly burstSaves;
  /** What each write on the mutation cache answers a caller that joins it. */
  readonly operations = new WeakMap<
    AnnotationMutation,
    Effect.Effect<MutationState, WriteRunFailed>
  >();
  /**
   * One Annotation History per Attachment, held only while a PDF view of the
   * Attachment keeps it open. An Attachment with no entry records nothing.
   */
  readonly histories = new Map<string, AnnotationHistory>();
  /**
   * The Attachments an undo or a redo is running on, which refuses a second
   * press while one runs.
   */
  readonly steppingAttachments = new Set<string>();
  /**
   * The Annotations a running step is writing right now. Their confirmations
   * record no step, because the step the write leaves behind is already the one
   * that steps it back; every other write confirmed while a step runs — a
   * comment autosave whose timer came due — is recorded as it always is.
   */
  readonly steppingWrites = new Set<string>();
  /**
   * How many writes are in flight on each Attachment, which is what the undo
   * key waits for: a press while a save is still on its way does nothing rather
   * than stepping past it.
   */
  readonly writesInFlight = new Map<string, number>();
  commandGeneration = 0;
  /** One explicit revalidation per visible Attachment, on the layer's Scope. */
  readonly refreshes;
  /** Verified database identity and revision for each Attachment read. */
  readonly databaseBindings = new Map<
    string,
    {
      source: DatabaseAnnotationSource;
      verifiedGeneration: number;
    }
  >();
  /**
   * The lock of each Annotation, by Attachment and then by Indexed Key, as the
   * last read of the Zotero database gave it: the one source of truth every
   * published list takes its locks from and every write is refused by. It is
   * kept apart from the lists, so a lock the database moved stands even where
   * a list is not published again.
   *
   * @see apps/obsidian/docs/adr/0067-annotation-locks-come-from-the-zotero-database.md
   */
  readonly locks = new Map<string, ReadonlyMap<string, AnnotationLock>>();
  /**
   * Each list with {@link locks} joined onto it, beside the locks it was
   * joined with, so a list drawn again under the same locks keeps its
   * identity and a surface that compares by identity does not redraw.
   */
  readonly lockedLists = new WeakMap<
    AnnotationList,
    { locks: ReadonlyMap<string, AnnotationLock>; list: AnnotationList }
  >();
  /** The whole collection currently published to both surfaces. */
  readonly publishedLists = new Map<string, AnnotationList>();
  /**
   * How many surfaces hold each Attachment's list, by Indexed Key. A list no
   * surface holds is dropped, so the collection grows only with what is on
   * screen.
   */
  readonly holds = new Map<string, number>();
  /** When a caller last asked for each Attachment's list, by Indexed Key. */
  readonly lastAsked = new Map<string, DateTime.Utc>();
  readonly publishedStatuses = new Map<
    string,
    Held<AnnotationList>["status"]
  >();
  /** Highest acknowledged API Library revision each database Library needs. */
  readonly acknowledgedRevisions = new Map<string, number>();
  /** Successful API writes a later complete API list must include. */
  readonly confirmedWrites = new Map<string, AnnotationConfirmation[]>();
  /** Gives each database acquisition a separate query-cache generation. */
  databaseGeneration = 0;
  /**
   * Gathers the database reads: every database read asked in one task, and
   * in one database generation, joins one batch, which reads all of them
   * under one Snapshot.
   */
  readonly databaseRows;
  /** The core's own background reads, which end when the layer's Scope closes. */
  readonly fibers;
  readonly writeToken;
  /**
   * The pixels this device's persisted Excerpt Image of one Annotation was made
   * from, which is the baseline a session's first read is compared against.
   */
  readonly persistedExcerpt;

  constructor(
    {
      bridge,
      db,
      queryClient,
      localApi,
      now,
      writeToken = newWriteToken,
      persistedExcerpt,
      publish,
    }: AnnotationRepositoryCoreDeps,
    { fibers, refreshes, idleSaves, burstSaves }: CoreFibers,
  ) {
    this.bridge = bridge;
    this.db = db;
    this.queries = queryClient;
    this.localApi = localApi;
    this.now = now;
    this.writeToken = writeToken;
    this.persistedExcerpt = persistedExcerpt;
    this.publish = publish;
    this.fibers = fibers;
    this.refreshes = refreshes;
    this.idleSaves = idleSaves;
    this.burstSaves = burstSaves;
    this.databaseRows = databaseRowsResolver(db, fibers);
  }

  readonly publish;
}

export { CoreState };
export type { CoreFibers };
