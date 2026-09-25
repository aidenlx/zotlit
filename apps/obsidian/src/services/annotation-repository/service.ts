// The Annotations of one Attachment, read from one Annotation Source at a time.
import type { Mutation, QueryFunction, QueryKey } from "@tanstack/query-core";

import {
  annotationTypeToName,
  getAnnotationsByParent,
  getAttachmentByKey,
  getLibraries,
  getZoteroDatabaseIdentity,
  parseAnnotationPosition,
  parseIndexedKey,
  resolveIndexedKeyLibrary,
  tagTypeToName,
} from "@zotlit/db";
import type {
  Annotation,
  AnnotationPosition,
  AnnotationPositionRaw,
  ResolvedAnnotationTypeName,
  TemplateTag,
} from "@zotlit/db";
import type { NodeDatabaseClient } from "@zotlit/db/client/node";
import { createNanoEvents } from "@zotlit/shared/nanoevents";

import { getLogger } from "@/lib/log";
import type { DatabaseService } from "@/services/database/service";
import { excerptFingerprint } from "@/services/excerpt-image/contract";
import type { Held, QueryClientService } from "@/services/query-client/service";
import { Service } from "@/services/service-base";
import type {
  LocalApiAnnotation,
  LocalApiFailure,
  LocalApiSource,
  ZoteroLocalApiClient,
} from "@/services/zotero-local-api/service";
import {
  libraryPath,
  readCreateResult,
} from "@/services/zotero-local-api/wire";

import { capabilityReason, editingCapabilityOf } from "./capability";
import type { EditingCapability } from "./capability";
import {
  AnnotationHistory,
  contentOf,
  historyFieldsOf,
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
import {
  resolvesSilently,
  sameStoredGeometry,
  storedPosition,
} from "./reconcile";
import {
  annotationTags,
  colorPatch,
  commentPatch,
  createRequest,
  eraseRequest,
  geometryPatch,
  IDLE,
  MAX_POSITION_LENGTH,
  mergeTags,
  newWriteToken,
  noTagChange,
  tagChange,
  tagsPatch,
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
  WriteConflict,
  WriteFailure,
  WriteRequest,
  WriteTarget,
} from "./write";

export type { EditingCapability } from "./capability";
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
  WriteConflict,
  WriteFailure,
} from "./write";

const logger = getLogger("annotation-repository");

/** The namespace this repository owns on the plugin-wide query client. */
const ANNOTATIONS = "annotations";

/** The partition the Zotero database answers from, keyed by Indexed Key. */
const ZOTERO_DB = "zotero-db";

/**
 * The partition the Zotero Local API answers from, keyed by the Zotero Server
 * ID and then by Indexed Key, so one server's records never stand for another's.
 */
const ZOTERO_LOCAL_API = "zotero-local-api";

const COMMENT_IDLE_SAVE_MS = 1_000;
const COMMENT_BURST_SAVE_MS = 10_000;

/**
 * Where a whole record set came from. The source is atomic per Attachment: a
 * list is wholly one source's, and the two sets never join.
 *
 * @see apps/obsidian/docs/adr/0034-the-annotation-source-is-atomic-per-attachment.md
 */
export interface DatabaseAnnotationSource {
  kind: "zotero-db";
  /** Standalone database identity, available before a Local API Server ID. */
  database: {
    userID: number | null;
    localUserKey: string | null;
    serverID: string | null;
  };
  libraryID: number;
  /** Committed Zotero Library revision held by this database snapshot. */
  libraryRevision: number | null;
}

export type AnnotationSource = DatabaseAnnotationSource | LocalApiSource;

/**
 * One Annotation as both sources describe it: Indexed Keys, a type name, and a
 * position already narrowed out of its stored JSON. The numeric SQLite item id
 * and the parent's content type stay inside the Zotero DB read path.
 *
 * @see apps/obsidian/docs/adr/0033-zotero-object-identity-is-the-indexed-key-server-id-is-source-data.md
 */
export interface AnnotationRecord {
  /** Indexed Key: the bare key for the personal library, `KEYgGROUPID` for a group. */
  key: string;
  type: ResolvedAnnotationTypeName;
  /** Hex colour code, e.g. `"#ffd400"`. */
  color: string | null;
  comment: string | null;
  text: string | null;
  /** The Attachment this Annotation hangs from, by Indexed Key. */
  parentKey: string;
  /** Zotero's printed-page label, as Zotero stored it. */
  pageLabel: string | null;
  /**
   * The Sort Index Zotero stores. It orders the list, an undone Geometry Edit
   * puts it back beside the position it was computed from, and a restore sends
   * it back: Zotero's create demands one and computes none.
   *
   * @see apps/obsidian/docs/adr/0040-the-sort-index-and-page-label-are-computed-in-obsidian-from-a-port-of-zoteros-text-structure.md
   */
  sortIndex: string;
  /**
   * The Annotation's Zotero tags, by name. Names rather than the numeric tag
   * ids SQLite keeps, because a name is what both sources can supply.
   */
  tags: readonly string[];
  /**
   * The same tags with the type Zotero stores for each, which a tag write
   * sends back. Both sources fill it; a record without it holds manual tags.
   */
  tagDetails?: readonly AnnotationTag[];
  /** Parsed once per read, so a redraw parses nothing. */
  position: AnnotationPosition;
  /**
   * The object version this read answered, which a write sends back as its
   * precondition. `null` under a source that keeps no versions — the Zotero DB
   * partition, where a write is refused before any request for exactly that
   * reason.
   *
   * @see apps/obsidian/docs/adr/0034-the-annotation-source-is-atomic-per-attachment.md
   */
  version: number | null;
  /** Source facts used by annotation templates; absent facts stay unknown. */
  templateMetadata?: {
    dateAdded: string | null;
    dateModified: string | null;
    authorName: string | null;
    isExternal: boolean | null;
    tags?: readonly Pick<TemplateTag, "name" | "type">[];
  };
}

/** One Attachment's Annotations, beside the source that answered for them. */
export interface AnnotationList {
  source: AnnotationSource;
  /** In Zotero's own reading order. */
  annotations: readonly AnnotationRecord[];
}

export type CommentDraftState =
  | { kind: "editing" }
  | { kind: "pending" }
  | { kind: "conflict"; fresh: string }
  | { kind: "failed"; failure: WriteFailure };

/** One Annotation comment being edited in this plugin session. */
export interface CommentDraft {
  annotationKey: string;
  attachmentKey: string;
  /** Zotero database that supplied the record when editing began. */
  serverID: string;
  /** Confirmed comment editing began from. */
  baseline: string;
  /** Current shared input. */
  text: string;
  state: CommentDraftState;
  /**
   * The next save requires an explicit action: set after a failed or
   * unconfirmed write, or when editing is lost while this draft is open.
   */
  manualSave?: boolean;
}

export type TagDraftState =
  | { kind: "editing" }
  | { kind: "pending" }
  | { kind: "failed"; failure: WriteFailure };

/**
 * The tag field of one Annotation Draft: one tag editing session, shared by
 * every surface through the comment draft's key. It is saved once, when the
 * editor closes.
 *
 * @see apps/obsidian/docs/adr/0063-annotation-tags-save-once-per-editing-session-and-merge-by-name.md
 */
export interface TagDraft {
  annotationKey: string;
  attachmentKey: string;
  /** Zotero database that supplied the record when the session began. */
  serverID: string;
  /** Confirmed tag names the session started from. */
  baseline: readonly string[];
  /** Current names in the shared editor. */
  names: readonly string[];
  /** `pending` while the save is in flight, which the editor shows as saving. */
  state: TagDraftState;
  /**
   * The next save requires Save tags: set after a failed or unconfirmed
   * write, or when editing is lost while this draft is open.
   */
  manualSave?: boolean;
  /**
   * The session ended with no write, and the draft waits for Save tags. No
   * editor holds it open, so a surface may offer Save tags without cutting a
   * session short.
   */
  held?: boolean;
}

/**
 * Everything the repository holds about one Annotation beside its record, as
 * one snapshot: a surface re-reads it whole on `annotation-changed`.
 */
export interface AnnotationState {
  /** What a write left on it; `pending` while one stands. */
  mutation: MutationState;
  /** Its comment draft in the active Zotero database. */
  commentDraft: CommentDraft | null;
  /** Its tag draft in the active Zotero database. */
  tagDraft: TagDraft | null;
  /**
   * A draft on it stands in another Zotero database, which hides it here: a
   * surface closes the editor that drew it, with nothing to save.
   */
  hidden: boolean;
  /** A complete read confirmed it no longer exists. */
  gone: boolean;
}

type CommentWriteDecision =
  | { kind: "drop" }
  | { kind: "retain" }
  | { kind: "update"; draft: CommentDraft };

/** Decide what one completed comment request leaves in repository memory. */
function commentDraftAfterWrite(
  current: CommentDraft,
  submittedText: string,
  outcome: MutationState,
): CommentWriteDecision {
  switch (outcome.kind) {
    case "idle":
      return sameComment(current.text, submittedText)
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
      // A comment write conflicts over a comment; only a Geometry Edit's
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

export interface AnnotationRepositoryEvents {
  /**
   * The list this Attachment holds was superseded. A consumer re-reads and
   * replaces the whole list; nothing patches a list in place.
   *
   * @param attachmentKey the Attachment's Indexed Key.
   */
  "annotations-changed": (attachmentKey: string) => void;
  /**
   * One Annotation's pixels moved: its geometry or its ink appearance decides
   * what an Excerpt Image crops and paints, while a comment, a tag, or a label
   * leaves the pixels as they were and says nothing here.
   *
   * A display holding an image of the previous pixels replaces it against this
   * record. A write this repository confirmed answers with the record Zotero
   * holds, so a consumer needs no list re-read to know the new pixels; an edit
   * saved in Zotero itself is what a later read, compared against the list that
   * stood before it — or, for the first read of a session, against the image
   * this device persists for the Annotation — finds and announces here.
   *
   * @param record the saved Annotation, whose `parentKey` names its Attachment.
   * @param source the Annotation Source the record was read or written through,
   *   which is what a consumer needs to resolve the record's files again.
   * @see apps/obsidian/docs/adr/0055-reader-edits-revalidate-excerpt-images.md
   */
  "excerpt-pixels-changed": (
    record: AnnotationRecord,
    source: AnnotationSource,
  ) => void;
  /**
   * What a surface may do to an Attachment's Annotations moved. Every consumer
   * re-reads {@link AnnotationRepository.capabilityFor}; no record set is
   * affected, so nothing re-reads a list for this.
   */
  "capability-changed": () => void;
  /**
   * Something the repository holds about one Annotation beside its record
   * moved: what a write left on it, its Annotation Draft, whether a database
   * switch hid that draft, or whether it is gone. A consumer re-reads the whole
   * {@link AnnotationRepository.annotationState} at once; the record itself
   * moves with `annotations-changed`.
   *
   * @param annotationKey the Annotation's Indexed Key.
   */
  "annotation-changed": (annotationKey: string) => void;
  /**
   * One Attachment's Annotation History opened, closed, or moved. A consumer
   * that draws whether an undo or a redo stands re-reads
   * {@link AnnotationRepository.canUndo} and
   * {@link AnnotationRepository.canRedo}; no record set is affected.
   *
   * @param attachmentKey the Attachment's Indexed Key.
   */
  "history-changed": (attachmentKey: string) => void;
  /**
   * Zotero's copy of this Annotation moved under a write, and the card now
   * carries both values with the verbs that resolve them. Raised only for a
   * conflict the user must answer: an equal fresh value settles silently and
   * says nothing.
   *
   * The seam that hears this is the one that opens the Annotation View on the
   * card where no view is showing it.
   *
   * @param annotationKey the Annotation's Indexed Key.
   * @param attachmentKey the Attachment it hangs from.
   */
  "write-conflict": (annotationKey: string, attachmentKey: string) => void;
}

export interface AnnotationRepositoryDeps {
  db: Pick<DatabaseService, "acquireRead" | "on" | "refresh">;
  queryClient: Pick<
    QueryClientService,
    "client" | "invalidate" | "keysUnder" | "peek" | "read" | "update"
  >;
  localApi: Pick<
    ZoteroLocalApiClient,
    | "authorizedSend"
    | "demandSource"
    | "listAnnotations"
    | "on"
    | "probe"
    | "readAnnotation"
    | "state"
    | "writeStateFor"
  >;
  /** The clock a cooldown deadline in the Editing Capability is read against. */
  now?: () => Temporal.Instant;
  /**
   * The write token each create carries.
   *
   * @default a fresh 32-character token per create
   */
  writeToken?: () => string;
  /**
   * The canonical pixel fingerprint of the Excerpt Image this device persists
   * for one Annotation — the display's own stored-outcome read — or `null`
   * where this device holds none.
   *
   * A session's first read of an Attachment has no list that stood before it,
   * so this is the baseline it is compared against instead: an edit saved in
   * Zotero while ZotLit was not running still announces the Annotation whose
   * pixels the image this device carries was made from. An Annotation it never
   * cached answers `null`, which says nothing and leaves it on demand.
   */
  persistedExcerpt?: (
    annotation: AnnotationRecord,
    source: AnnotationSource,
  ) => Promise<string | null>;
}

/** One Annotation, beside the held list a write reads and replaces it in. */
interface HeldAnnotation {
  queryKey: QueryKey;
  /** The Attachment's Indexed Key, which the record itself names. */
  attachmentKey: string;
  record: AnnotationRecord;
}

/** What one command asks Zotero for, which a conflict puts beside the fresh record. */
type WriteAttempt =
  | { write: Exclude<ConflictedWrite, "geometry">; attempted: string | null }
  | { write: "geometry"; attempted: GeometryEdit; input: GeometryInput }
  /** `session` marks a tag editing session's own save, not a tag undo or redo. */
  | { write: "tags"; session?: true };

type ConfirmedWrite =
  | {
      kind: "record";
      record: AnnotationRecord;
      write: "color" | "comment" | "geometry" | "tags";
    }
  | { kind: "created"; record: AnnotationRecord }
  | { kind: "deleted"; annotationKey: string };

/** One write of a group that landed, held until the whole group settles. */
interface GroupWrite {
  attachmentKey: string;
  /** The held record the write was sent against. */
  before: AnnotationRecord;
  /** What Zotero answered the write with. */
  applied: ConfirmedWrite;
}

/**
 * The kind of History Step a group records. A group of deletes is the only
 * group a gesture sends.
 */
type GroupKind = Extract<FieldHistoryStep["kind"], "existence">;

/** Where the writes of one group put what they landed. */
interface GroupWrites {
  /** The one kind of step every write of the group joins. */
  kind: GroupKind;
  writes: GroupWrite[];
}

/**
 * What one confirmed write changed, as the History Step that puts it back
 * names it: a delete the whole Annotation, a patch of one field that field's
 * value. A comment and a tag session are recorded by rules of their own, and
 * have no change here.
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
          },
        }
      : null;
  }
  if (
    applied.kind !== "record" ||
    applied.write === "comment" ||
    applied.write === "tags"
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

interface CommentSave {
  idleTimer: ReturnType<typeof setTimeout> | null;
  burstTimer: ReturnType<typeof setTimeout> | null;
}

/** The fields a write in flight proposes, as Zotero will answer them. */
type ProposedFields = Partial<
  Pick<
    AnnotationRecord,
    | "color"
    | "comment"
    | "tags"
    | "tagDetails"
    | "position"
    | "sortIndex"
    | "text"
  >
>;

/**
 * What one write in flight proposes for its Annotation: its mutation's
 * variables, which every published list draws in place of the confirmed fields
 * until the write settles.
 */
interface PendingProposal {
  annotationKey: string;
  attachmentKey: string;
  /** The Zotero database the write goes to; another's list draws none of it. */
  serverID: string | null;
  fields: ProposedFields;
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

type AnnotationMutation = Mutation<
  MutationState,
  Error,
  PendingProposal | null
>;
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
 * @see apps/obsidian/docs/adr/0034-the-annotation-source-is-atomic-per-attachment.md
 * @see docs/adr/0060-held-reads-are-realized-on-tanstack-query-core.md
 */
export class AnnotationRepository extends Service<void> {
  readonly #db;
  readonly #queries;
  readonly #localApi;
  readonly #now;
  readonly #emitter = createNanoEvents<AnnotationRepositoryEvents>();
  /**
   * The last Editing Capability each consumer was given, by Attachment and by
   * `null` for the session, so a change is logged once rather than per read.
   */
  readonly #lastCapability = new Map<string | null, string>();
  /**
   * The failure or conflict a settled write left standing on each Annotation,
   * by Indexed Key, until the next write on it or a dismissal. A write in
   * flight is read from the mutation cache instead, so an Annotation that is
   * idle has no entry.
   */
  readonly #outcomes = new Map<string, MutationState>();
  /** The pending state each write in the mutation cache shows while it stands. */
  readonly #pendingStates = new WeakMap<AnnotationMutation, MutationState>();
  /** Every Annotation a complete read confirmed gone, by Indexed Key. */
  readonly #gone = new Set<string>();
  /**
   * The keys the last complete read of each Attachment answered, by the
   * database it came from, which the next one is compared against.
   */
  readonly #completeKeys = new Map<string, ReadonlySet<string>>();
  readonly #commentDrafts = new Map<string, CommentDraft>();
  readonly #commentDraftSources = new Map<string, string>();
  readonly #commentSaves = new Map<string, CommentSave>();
  /** Tag drafts, under the comment draft's key. */
  readonly #tagDrafts = new Map<string, TagDraft>();
  readonly #tagDraftSources = new Map<string, string>();
  /** What each write on the mutation cache answers its callers. */
  readonly #operations = new WeakMap<
    AnnotationMutation,
    Promise<MutationState>
  >();
  /**
   * One Annotation History per Attachment, held only while a PDF view of the
   * Attachment keeps it open. An Attachment with no entry records nothing.
   */
  readonly #histories = new Map<string, AnnotationHistory>();
  /**
   * The Attachments an undo or a redo is running on, which refuses a second
   * press while one runs.
   */
  readonly #steppingAttachments = new Set<string>();
  /**
   * The Annotations a running step is writing right now. Their confirmations
   * record no step, because the step the write leaves behind is already the one
   * that steps it back; every other write confirmed while a step runs — a
   * comment autosave whose timer came due — is recorded as it always is.
   */
  readonly #steppingWrites = new Set<string>();
  /**
   * How many writes are in flight on each Attachment, which is what the undo
   * key waits for: a press while a save is still on its way does nothing rather
   * than stepping past it.
   */
  readonly #writesInFlight = new Map<string, number>();
  #commandGeneration = 0;
  /** One explicit revalidation per visible Attachment. */
  readonly #refreshes = new Map<string, Promise<AnnotationList | null>>();
  /** Verified database identity and revision for each Attachment read. */
  readonly #databaseSources = new Map<string, DatabaseAnnotationSource>();
  /** Last accepted database namespace, retained while a refresh is pending. */
  readonly #databaseServerIDs = new Map<string, string | null>();
  /** The whole collection currently published to both surfaces. */
  readonly #publishedLists = new Map<string, AnnotationList>();
  readonly #publishedStatuses = new Map<
    string,
    Held<AnnotationList>["status"]
  >();
  /** Highest acknowledged API Library revision each database Library needs. */
  readonly #acknowledgedRevisions = new Map<string, number>();
  /** Successful API writes a later complete API list must include. */
  readonly #confirmedWrites = new Map<string, ConfirmedWrite[]>();
  /** Gives each database acquisition a separate query-cache generation. */
  #databaseGeneration = 0;
  readonly #writeToken;
  /**
   * The pixels this device's persisted Excerpt Image of one Annotation was made
   * from, which is the baseline a session's first read is compared against.
   */
  readonly #persistedExcerpt;

  ready: Promise<void>;

  constructor({
    db,
    queryClient,
    localApi,
    now = () => Temporal.Now.instant(),
    writeToken = newWriteToken,
    persistedExcerpt,
  }: AnnotationRepositoryDeps) {
    super();
    this.#db = db;
    this.#queries = queryClient;
    this.#localApi = localApi;
    this.#now = now;
    this.#writeToken = writeToken;
    this.#persistedExcerpt = persistedExcerpt;
    this.ready = this.#load();
  }

  /**
   * @param attachmentKey the Attachment's Indexed Key.
   * @returns the list that stands, with the Pending Proposal of each write in
   *   flight drawn over it, or null while no read has answered for it.
   */
  async read(attachmentKey: string): Promise<AnnotationList | null> {
    const { queryKey, read } = this.#activePartition(attachmentKey);
    const candidate = await this.#queries.read(queryKey, read);
    if (candidate && this.#canPublish(attachmentKey, candidate, queryKey)) {
      if (candidate.source.kind === "zotero-db") {
        this.#adoptDatabaseSource(attachmentKey, candidate.source);
      } else if (
        coversConfirmations(candidate, this.#confirmedWrites.get(attachmentKey))
      ) {
        this.#confirmedWrites.delete(attachmentKey);
      }
      const superseded = this.#publishedLists.get(attachmentKey);
      this.#publishedLists.set(attachmentKey, candidate);
      this.#publishedStatuses.set(
        attachmentKey,
        this.#queries.peek<AnnotationList>(queryKey)?.status ?? "fresh",
      );
      this.#reconcilePublishedDrafts(queryKey, attachmentKey, candidate);
      await this.#announceReadPixels(superseded, candidate);
      return this.#withProposals(attachmentKey, candidate);
    }
    const published = this.#publishedLists.get(attachmentKey);
    if (
      candidate?.source.kind === "zotero-local-api" &&
      published?.source.kind === "zotero-local-api" &&
      candidate.source.serverID === published.source.serverID
    ) {
      this.#queries.update<AnnotationList>(queryKey, () => published);
    }
    return this.#published(attachmentKey)?.value ?? null;
  }

  /**
   * Revalidates one Attachment through its active source. Concurrent surfaces
   * join the same operation, while the Held Read keeps their published list.
   */
  refresh(attachmentKey: string): Promise<AnnotationList | null> {
    const running = this.#refreshes.get(attachmentKey);
    if (running) return running;

    const refreshing = this.#refresh(attachmentKey)
      .catch((error: unknown) => {
        logger.warn("Failed to refresh an Attachment's annotations", {
          attachmentKey,
          error,
        });
        if (this.#publishedLists.has(attachmentKey)) {
          this.#publishedStatuses.set(attachmentKey, "failed");
        }
        return this.peek(attachmentKey)?.value ?? null;
      })
      .finally(() => {
        if (this.#refreshes.get(attachmentKey) === refreshing) {
          this.#refreshes.delete(attachmentKey);
        }
      });
    this.#refreshes.set(attachmentKey, refreshing);
    return refreshing;
  }

  /** Probes source availability, refreshes the active adapter, then reads it. */
  async #refresh(attachmentKey: string): Promise<AnnotationList | null> {
    await this.#localApi.probe();
    if (this.#compatibleApiSource(attachmentKey) === null) {
      await this.#db.refresh();
    }
    const { queryKey } = this.#activePartition(attachmentKey);
    this.#emitter.emit("annotations-changed", attachmentKey);
    this.#queries.invalidate(queryKey);
    const value = await this.read(attachmentKey);
    const status = this.#queries.peek<AnnotationList>(queryKey)?.status;
    if (value && status === "failed") {
      this.#publishedStatuses.set(attachmentKey, status);
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
  peek(attachmentKey: string): Held<AnnotationList> | null {
    return this.#published(attachmentKey);
  }

  /**
   * What a surface may do to one Attachment's Annotations: the Capability
   * Probe, plus what the write path learned about this Attachment's library and
   * about the authorization gesture in flight.
   *
   * @param attachmentKey the Attachment's Indexed Key.
   */
  capabilityFor(attachmentKey: string): EditingCapability {
    return this.#capability(attachmentKey);
  }

  /**
   * What the session itself may do, with no Attachment in hand — what the
   * "Zotero editing" settings row shows. A library Zotero refuses writes to is
   * a fact about one Attachment and has no place here.
   */
  get capability(): EditingCapability {
    return this.#capability(null);
  }

  /**
   * Re-check Zotero now, from a user gesture: the Editing Capability
   * affordance's click, and a keystroke that met a block. A probe that changes
   * anything announces itself through `capability-changed`.
   */
  async probe(): Promise<void> {
    await this.#localApi.probe();
  }

  /**
   * What a write left on one Annotation, for the card that draws its verbs:
   * `pending` from the moment a write is asked for until the last write queued
   * on it settles, then the failure or conflict the last one left standing.
   *
   * @param annotationKey the Annotation's Indexed Key.
   */
  mutationFor(annotationKey: string): MutationState {
    const [running] = this.#pendingWrites(annotationKey);
    return (
      (running && this.#pendingStates.get(running)) ??
      this.#outcomes.get(annotationKey) ??
      IDLE
    );
  }

  /**
   * Everything the repository holds about one Annotation beside its record.
   *
   * @param annotationKey the Annotation's Indexed Key.
   */
  annotationState(annotationKey: string): AnnotationState {
    const commentDraft = this.commentDraftFor(annotationKey);
    const tagDraft = this.tagDraftFor(annotationKey);
    const shown = new Set<CommentDraft | TagDraft>(
      [commentDraft, tagDraft].filter((draft) => draft !== null),
    );
    return {
      mutation: this.mutationFor(annotationKey),
      commentDraft,
      tagDraft,
      hidden: [
        ...this.#commentDrafts.values(),
        ...this.#tagDrafts.values(),
      ].some(
        (draft) => draft.annotationKey === annotationKey && !shown.has(draft),
      ),
      gone: this.#gone.has(annotationKey),
    };
  }

  /** The active Zotero database's shared draft for one Annotation. */
  commentDraftFor(annotationKey: string): CommentDraft | null {
    const source = this.#localApi.demandSource();
    const serverID =
      source?.serverID ?? this.#commentDraftSources.get(annotationKey);
    return serverID
      ? (this.#commentDrafts.get(commentDraftID(serverID, annotationKey)) ??
          null)
      : null;
  }

  /** Start or update one shared comment draft. */
  editComment(annotationKey: string, text?: string): CommentDraft | null {
    const source = this.#localApi.demandSource();
    const serverID =
      source?.serverID ?? this.#commentDraftSources.get(annotationKey);
    const id = serverID ? commentDraftID(serverID, annotationKey) : null;
    const standing = id ? this.#commentDrafts.get(id) : undefined;
    const held = standing ? null : this.#holding(annotationKey);
    if (!id || (!standing && (!source || !held))) return null;
    const capability = this.capabilityFor(
      standing?.attachmentKey ?? held!.attachmentKey,
    );
    if (capability.kind !== "writable") return standing ?? null;
    const baseline = standing?.baseline ?? held!.record.comment ?? "";
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
    this.#commentDrafts.set(id, draft);
    this.#commentDraftSources.set(annotationKey, draft.serverID);
    this.#emitter.emit("annotation-changed", annotationKey);
    if (text !== undefined && draft.state.kind !== "conflict") {
      this.#scheduleCommentSave(draft);
    }
    return draft;
  }

  /** Submit the current shared draft once. */
  submitComment(
    annotationKey: string,
    { automatic = false }: { automatic?: boolean } = {},
  ): Promise<MutationState> {
    const draft = this.commentDraftFor(annotationKey);
    if (!draft) return Promise.resolve(IDLE);
    this.#clearCommentTimers(
      this.#commentSave(commentDraftID(draft.serverID, annotationKey)),
    );
    if (draft.state.kind === "conflict") {
      return Promise.resolve(this.mutationFor(annotationKey));
    }
    const saving = this.#savingComment(annotationKey);
    // A draft holding what Zotero already has is not a draft: it is dropped
    // ahead of every other answer, so an editor the user opened and closed
    // without typing leaves nothing behind for a card to announce. Manual-save
    // mode does not hold it either — there is nothing there to save.
    if (!saving && sameComment(draft.text, draft.baseline)) {
      this.#dropCommentDraft(annotationKey);
      return Promise.resolve(IDLE);
    }
    // Text a save already carries needs no second one.
    if (
      saving &&
      sameComment(saving.state.variables?.fields.comment ?? null, draft.text)
    ) {
      return this.#answerOf(saving);
    }
    // Text typed while a save is in flight queues behind it, even behind the
    // Save comment pressed on a held draft, which that save's success ends.
    if (!saving) {
      if (automatic && !this.#canAutosave(draft)) return Promise.resolve(IDLE);
      const capability = this.capabilityFor(draft.attachmentKey);
      if (capability.kind !== "writable")
        return Promise.resolve({
          kind: "failed",
          failure: this.#writeBlocked(draft.attachmentKey)!,
        });
    }
    const submittedText = draft.text;
    this.#setCommentDraft(draft, { kind: "pending" });
    return this.#submitComment(annotationKey, draft, {
      submittedText,
      automatic,
    });
  }

  async #submitComment(
    annotationKey: string,
    submitted: CommentDraft,
    { submittedText, automatic }: { submittedText: string; automatic: boolean },
  ): Promise<MutationState> {
    const id = commentDraftID(submitted.serverID, annotationKey);
    return await this.#writeComment(annotationKey, submittedText, {
      // The draft takes the save's outcome before the next write on the
      // Annotation starts, so a save queued behind a failed one is held.
      run: async (send, own) => {
        if (this.#commentSuperseded(annotationKey, own, { id, automatic })) {
          logger.debug("A queued comment save stood down", { annotationKey });
          return { kind: "pending", write: "comment" };
        }
        const outcome = await send();
        const current = this.#commentDrafts.get(id);
        if (current && current.state.kind !== "conflict") {
          this.#applyCommentWriteDecision({
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
   * Whether a comment save that waited its turn is no longer needed: a later
   * comment save or a delete on the same Annotation replaces it, or its draft
   * ended, met a conflict, or was held by a failed save while it waited. An
   * automatic save also stands down where autosave is off.
   */
  #commentSuperseded(
    annotationKey: string,
    own: AnnotationMutation,
    { id, automatic }: { id: string; automatic: boolean },
  ): boolean {
    const current = this.#commentDrafts.get(id);
    if (
      !current ||
      current.state.kind === "conflict" ||
      current.state.kind === "failed" ||
      (automatic && !this.#canAutosave(current))
    ) {
      return true;
    }
    const writes = this.#pendingWrites(annotationKey);
    return writes.slice(writes.indexOf(own) + 1).some(({ options }) => {
      const write = options.mutationKey?.[2];
      return write === "comment" || write === "delete";
    });
  }

  /** Keep Zotero's reviewed comment and discard the local draft. */
  discardCommentDraft(annotationKey: string): void {
    this.#dropCommentDraft(annotationKey);
    const mutation = this.#outcomes.get(annotationKey);
    if (
      mutation?.kind === "conflict" &&
      mutation.conflict.write === "comment"
    ) {
      this.#settle(annotationKey, IDLE);
    }
  }

  /** Apply the shared draft again against the reviewed fresh record. */
  retryCommentDraft(annotationKey: string): Promise<MutationState> {
    const draft = this.commentDraftFor(annotationKey);
    if (!draft) return Promise.resolve(IDLE);
    this.#clearCommentTimers(
      this.#commentSave(commentDraftID(draft.serverID, annotationKey)),
    );
    const saving = this.#savingComment(annotationKey);
    if (saving) return this.#answerOf(saving);
    return this.#retryCommentDraft(annotationKey, draft);
  }

  async #retryCommentDraft(
    annotationKey: string,
    draft: CommentDraft,
  ): Promise<MutationState> {
    const held = this.#holding(annotationKey);
    const reviewed =
      draft.state.kind === "conflict" ? draft.state.fresh : draft.baseline;
    const fresh = held?.record.comment ?? "";
    if (!held || !sameComment(fresh, reviewed)) {
      const outcome: MutationState = {
        kind: "conflict",
        conflict: { write: "comment", attempted: draft.text, fresh },
      };
      this.#settle(annotationKey, outcome);
      this.#setCommentDraft(draft, { kind: "conflict", fresh });
      if (held) {
        this.#emitter.emit("write-conflict", annotationKey, held.attachmentKey);
      }
      return outcome;
    }
    const submittedText = draft.text;
    const id = commentDraftID(draft.serverID, annotationKey);
    this.#setCommentDraft(draft, { kind: "pending" });
    let outcome = await this.patchComment(annotationKey, submittedText);
    if (
      outcome.kind === "conflict" &&
      outcome.conflict.write === "comment" &&
      sameComment(outcome.conflict.fresh, reviewed)
    ) {
      outcome = await this.patchComment(annotationKey, submittedText);
    }
    const current = this.#commentDrafts.get(id);
    if (!current) return outcome;
    this.#applyCommentWriteDecision({
      annotationKey,
      current,
      submittedText,
      outcome,
    });
    return outcome;
  }

  #applyCommentWriteDecision({
    annotationKey,
    current,
    submittedText,
    outcome,
    own,
  }: {
    annotationKey: string;
    current: CommentDraft;
    submittedText: string;
    outcome: MutationState;
    /** The write that answered, while it still counts as in flight. */
    own?: AnnotationMutation;
  }): void {
    const decision = commentDraftAfterWrite(current, submittedText, outcome);
    const later = this.#savingComment(annotationKey);
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
      this.#dropCommentDraft(annotationKey, current.serverID);
    } else if (decision.kind === "update") {
      this.#commentDrafts.set(
        commentDraftID(current.serverID, annotationKey),
        decision.draft,
      );
      this.#emitter.emit("annotation-changed", annotationKey);
      // Text typed while the save was away, even behind a Save comment
      // pressed on a held draft, whose success ends the hold, is sent now.
      if (outcome.kind === "idle" && decision.draft.state.kind === "editing") {
        void this.submitComment(annotationKey, { automatic: true });
      }
    }
  }

  /** The active Zotero database's shared tag draft for one Annotation. */
  tagDraftFor(annotationKey: string): TagDraft | null {
    const serverID =
      this.#localApi.demandSource()?.serverID ??
      this.#tagDraftSources.get(annotationKey);
    return serverID
      ? (this.#tagDrafts.get(commentDraftID(serverID, annotationKey)) ?? null)
      : null;
  }

  /**
   * Start or update one tag editing session. A session starts from the
   * confirmed names and only while editing is available. A draft whose save
   * is in flight stays as it is, because the editor is saving.
   *
   * @param names the editor's current names; left out, the session starts or
   *   stays as it is.
   */
  editTags(annotationKey: string, names?: readonly string[]): TagDraft | null {
    const standing = this.tagDraftFor(annotationKey);
    if (standing?.state.kind === "pending") return standing;
    const source = this.#localApi.demandSource();
    const held = standing ? null : this.#holding(annotationKey);
    if (!standing && (!source || !held)) return null;
    const attachmentKey = standing?.attachmentKey ?? held!.attachmentKey;
    const capability = this.capabilityFor(attachmentKey);
    // While editing is unavailable no session starts, but a standing one
    // still takes its editor's last names: the editor closing as editing goes
    // adds the text still typed, which the held draft keeps for Save tags.
    if (capability.kind !== "writable" && (!standing || names === undefined))
      return standing;
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
    this.#setTagDraft(draft);
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
  async submitTags(
    annotationKey: string,
    { automatic = false }: { automatic?: boolean } = {},
  ): Promise<MutationState> {
    const draft = this.tagDraftFor(annotationKey);
    if (!draft) return IDLE;
    if (draft.state.kind === "pending") return this.mutationFor(annotationKey);
    const change = tagChange(draft.baseline, draft.names);
    if (noTagChange(change)) {
      this.#dropTagDraft(draft);
      return IDLE;
    }
    if (automatic && !this.#canAutosave(draft)) {
      logger.debug("A tag draft is held for Save tags", {
        annotationKey,
        state: draft.state.kind,
        capability: this.capabilityFor(draft.attachmentKey).kind,
      });
      this.#setTagDraft({ ...draft, manualSave: true, held: true });
      return IDLE;
    }
    const blocked = this.#writeBlocked(draft.attachmentKey);
    if (blocked) {
      this.#setTagDraft({
        ...draft,
        manualSave: true,
        held: true,
        state: { kind: "failed", failure: blocked },
      });
      return { kind: "failed", failure: blocked };
    }
    this.#setTagDraft({ ...draft, state: { kind: "pending" } });
    logger.debug("A tag editing session is saved", {
      annotationKey,
      added: change.added.length,
      removed: change.removed.length,
    });
    const outcome = await this.#command(annotationKey, {
      write: "tags",
      session: true,
      request: (target, record) =>
        tagsPatch(target, mergeTags(annotationTags(record), change)),
      propose: (record) =>
        proposedTags(mergeTags(annotationTags(record), change)),
    });
    const current = this.#tagDrafts.get(
      commentDraftID(draft.serverID, annotationKey),
    );
    if (!current) return outcome;
    if (outcome.kind === "failed") {
      this.#setTagDraft({
        ...current,
        manualSave: true,
        held: true,
        state: outcome,
      });
    } else {
      this.#dropTagDraft(current);
    }
    return outcome;
  }

  /** Drop a held tag draft and keep the tags Zotero holds. */
  discardTagDraft(annotationKey: string): void {
    const draft = this.tagDraftFor(annotationKey);
    if (draft && draft.state.kind !== "pending") this.#dropTagDraft(draft);
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
  async createAnnotation(
    attachmentKey: string,
    draft: Omit<AnnotationDraft, "parentKey">,
    options: { group?: string } = {},
  ): Promise<CreateOutcome> {
    return await this.#counted(
      attachmentKey,
      this.#createAnnotation(attachmentKey, draft, options.group),
    );
  }

  async #createAnnotation(
    attachmentKey: string,
    draft: Omit<AnnotationDraft, "parentKey">,
    group: string | undefined,
  ): Promise<CreateOutcome> {
    const parsed = parseIndexedKey(attachmentKey);
    if (!parsed) {
      return { kind: "failed", failure: { kind: "unknown-annotation" } };
    }
    if (!this.#compatibleApiSource(attachmentKey)) {
      return { kind: "failed", failure: { kind: "db-source" } };
    }
    const whole = { ...draft, parentKey: parsed.key };
    if (writePosition(whole.position).length > MAX_POSITION_LENGTH) {
      logger.debug("A selection's position is longer than Zotero accepts", {
        attachmentKey,
      });
      return { kind: "failed", failure: { kind: "position-too-large" } };
    }

    const blocked = this.#writeBlocked(attachmentKey);
    if (blocked) return { kind: "failed", failure: blocked };

    const library = libraryPath(parsed);
    const request = createRequest(library, whole, this.#writeToken());
    const source = this.#compatibleApiSource(attachmentKey);
    const reply = await this.#localApi.authorizedSend(request.path, {
      library,
      method: request.method,
      headers: request.headers,
      body: request.body,
    });
    if (!source || !(await this.#apiSourceStillBound(attachmentKey, source))) {
      return { kind: "failed", failure: { kind: "server-changed" } };
    }
    if ("failure" in reply) {
      logger.debug("Zotero did not confirm an annotation create", {
        attachmentKey,
        failure: reply.failure,
      });
      await this.refresh(attachmentKey);
      return { kind: "failed", failure: reply.failure };
    }

    const created = readCreateResult(reply.value.text, {
      parentKey: attachmentKey,
      type: whole.type,
    });
    if ("failure" in created) {
      await this.refresh(attachmentKey);
      return { kind: "failed", failure: created.failure };
    }

    const annotationKey = created.value.key;
    this.#rememberAcknowledgedRevision(attachmentKey, reply.value.headers);
    const { queryKey } = this.#activePartition(attachmentKey);
    const record = fromLocalApi(created.value);
    this.#queries.update<AnnotationList>(queryKey, (list) => ({
      ...list,
      annotations: [...list.annotations, record],
    }));
    this.#publishQuery(attachmentKey, queryKey);
    await this.#refreshConfirmed(attachmentKey, {
      kind: "created",
      record,
    });
    logger.debug("Zotero created an annotation", {
      attachmentKey,
      annotationKey,
      type: whole.type,
    });
    const content = contentOf(record);
    if (content) {
      this.#recordExistence(
        attachmentKey,
        { annotationKey, before: { content: null }, after: { content } },
        group,
      );
    }
    this.#emitter.emit("annotations-changed", attachmentKey);
    return { kind: "created", annotationKey };
  }

  /**
   * Recolour one Annotation, of whatever type: Zotero's colour setter is one
   * rule for all six, so an ink stroke recolours like a highlight.
   *
   * @param annotationKey the Annotation's Indexed Key.
   * @param color the swatch to store, in any case; the write sends lower case.
   */
  async patchColor(
    annotationKey: string,
    color: string,
  ): Promise<MutationState> {
    return await this.#command(annotationKey, {
      write: "color",
      attempted: color,
      request: (target) => colorPatch(target, color),
      propose: () => ({ color: wireColor(color) }),
    });
  }

  /**
   * Replace one Annotation's comment. An empty string clears it.
   *
   * @param annotationKey the Annotation's Indexed Key.
   */
  async patchComment(
    annotationKey: string,
    comment: string,
  ): Promise<MutationState> {
    return await this.#writeComment(annotationKey, comment);
  }

  async #writeComment(
    annotationKey: string,
    comment: string,
    { run }: { run?: WriteTurn } = {},
  ): Promise<MutationState> {
    return await this.#command(annotationKey, {
      write: "comment",
      attempted: comment,
      request: (target) => commentPatch(target, comment),
      // Zotero stores an empty comment as no value.
      propose: () => ({ comment: comment === "" ? null : comment }),
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
  async patchGeometry(
    annotationKey: string,
    edit: GeometryEdit,
    input: GeometryInput,
  ): Promise<MutationState> {
    if (writePosition(edit.position).length > MAX_POSITION_LENGTH) {
      logger.debug("A Geometry Edit's position is longer than Zotero accepts", {
        annotationKey,
      });
      return this.#settle(annotationKey, {
        kind: "failed",
        failure: { kind: "position-too-large" },
      });
    }
    return await this.#command(annotationKey, {
      write: "geometry",
      attempted: edit,
      input,
      request: (target, record) => geometryPatch(target, record.type, edit),
      propose: (record) => proposedGeometry(record, edit),
      ...(input === "keyboard" && {
        join: { input, at: this.#now() },
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
  async deleteAnnotation(annotationKey: string): Promise<MutationState> {
    return await this.#erase(annotationKey);
  }

  /**
   * @param gather where a delete of a group puts its landed write, rather than
   *   recording a step of its own.
   */
  async #erase(
    annotationKey: string,
    gather?: GroupWrites,
  ): Promise<MutationState> {
    this.#cancelCommentSave(annotationKey);
    return await this.#command(annotationKey, {
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
   * land is not in it.
   *
   * @param annotationKeys Indexed Keys, in the order the step names them.
   * @returns one outcome per key, in the order of `annotationKeys`.
   */
  async deleteAnnotations(
    annotationKeys: readonly string[],
  ): Promise<MutationState[]> {
    return await this.#groupWrite("existence", annotationKeys, (key, gather) =>
      this.#erase(key, gather),
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
   * @param kind the one kind of step every write of the group joins.
   * @param write one Annotation's write, which puts what it landed in `gather`.
   * @returns one outcome per key, in the order of `annotationKeys`.
   */
  async #groupWrite(
    kind: GroupKind,
    annotationKeys: readonly string[],
    write: (
      annotationKey: string,
      gather: GroupWrites,
    ) => Promise<MutationState>,
  ): Promise<MutationState[]> {
    const gather: GroupWrites = { kind, writes: [] };
    const settled = await Promise.allSettled(
      annotationKeys.map((key) => write(key, gather)),
    );
    const byAttachment = Map.groupBy(
      gather.writes,
      (entry) => entry.attachmentKey,
    );
    for (const [attachmentKey, writes] of byAttachment)
      this.#recordGroup(attachmentKey, annotationKeys, { kind, writes });
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
  async retryWrite(annotationKey: string): Promise<MutationState> {
    const standing = this.#outcomes.get(annotationKey);
    if (standing?.kind !== "conflict") return standing ?? IDLE;
    const { conflict } = standing;
    switch (conflict.write) {
      case "color":
        return await this.patchColor(annotationKey, conflict.attempted ?? "");
      case "comment":
        return await this.patchComment(annotationKey, conflict.attempted ?? "");
      case "delete":
        return await this.deleteAnnotation(annotationKey);
      case "geometry":
        return await this.patchGeometry(
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
  discardConflict(annotationKey: string): void {
    if (this.#outcomes.get(annotationKey)?.kind !== "conflict") return;
    logger.debug("A write conflict was discarded", { annotationKey });
    this.#settle(annotationKey, IDLE);
  }

  /**
   * Open this Attachment's Annotation History, from one PDF view bound to it.
   * Every surface that writes through this repository records into the history
   * the Attachment already holds, so a second view of the same Attachment joins
   * this one rather than starting its own.
   *
   * @param attachmentKey the Attachment's Indexed Key.
   */
  openHistory(attachmentKey: string): void {
    const standing = this.#histories.get(attachmentKey);
    if (standing) {
      standing.hold();
      return;
    }
    this.#histories.set(attachmentKey, new AnnotationHistory());
    logger.debug("An annotation history opened", { attachmentKey });
    this.#emitter.emit("history-changed", attachmentKey);
  }

  /**
   * Give up one PDF view's hold on this Attachment's Annotation History. The
   * last view to close ends the history, so an old session can never revert
   * today's work.
   *
   * @param attachmentKey the Attachment's Indexed Key.
   */
  closeHistory(attachmentKey: string): void {
    const standing = this.#histories.get(attachmentKey);
    if (!standing || standing.release() > 0) return;
    this.#histories.delete(attachmentKey);
    logger.debug("An annotation history closed", { attachmentKey });
    this.#emitter.emit("history-changed", attachmentKey);
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
  canUndo(attachmentKey: string): boolean {
    return this.#stepStands(attachmentKey, "undo");
  }

  /** Whether this Attachment's Annotation History holds a step to redo. */
  canRedo(attachmentKey: string): boolean {
    return this.#stepStands(attachmentKey, "redo");
  }

  /**
   * Step one confirmed edit back: the platform undo key, and the palette's
   * "Undo annotation change".
   *
   * @param attachmentKey the Attachment's Indexed Key.
   */
  async undo(attachmentKey: string): Promise<HistoryOutcome> {
    return await this.#stepHistory(attachmentKey, "undo");
  }

  /** Step one undone edit forward again. */
  async redo(attachmentKey: string): Promise<HistoryOutcome> {
    return await this.#stepHistory(attachmentKey, "redo");
  }

  on<K extends keyof AnnotationRepositoryEvents>(
    event: K,
    cb: AnnotationRepositoryEvents[K],
  ): () => void {
    return this.#emitter.on(event, cb);
  }

  async #load(): Promise<void> {
    await using stack = new AsyncDisposableStack();
    stack.defer(this.#db.on("changed", () => this.#dropDatabasePartition()));
    stack.defer(this.#localApi.on("changed", () => this.#sourceMoved()));
    stack.defer(
      this.#localApi.on("capability-changed", () => {
        for (const [id, draft] of this.#commentDrafts) {
          if (this.capabilityFor(draft.attachmentKey).kind === "writable")
            continue;
          this.#cancelCommentSave(draft.annotationKey, draft.serverID);
          this.#commentDrafts.set(id, { ...draft, manualSave: true });
          this.#emitter.emit("annotation-changed", draft.annotationKey);
        }
        // A tag draft has no timer or queued save to cancel, unlike a comment
        // draft, so one already held needs no second event.
        for (const draft of this.#tagDrafts.values()) {
          if (
            draft.manualSave ||
            this.capabilityFor(draft.attachmentKey).kind === "writable"
          )
            continue;
          this.#setTagDraft({ ...draft, manualSave: true });
        }
        this.#emitter.emit("capability-changed");
      }),
    );
    stack.defer(() => this.#cancelAllCommentSaves());
    stack.defer(() => {
      this.#commandGeneration += 1;
    });
    this.commit(stack.move());
  }

  /**
   * One Editing Capability, logged at debug where it differs from the last
   * value this consumer was given for the same subject — every read at trace,
   * every change at debug, so a session's capability history is in the log
   * without one line per redraw.
   *
   * @param attachmentKey the Attachment, or null for the session itself.
   */
  #capability(attachmentKey: string | null): EditingCapability {
    const capability =
      attachmentKey !== null &&
      this.#localApi.demandSource() &&
      !this.#compatibleApiSource(attachmentKey)
        ? ({ kind: "read-only", reason: "server-changed" } as const)
        : editingCapabilityOf(
            this.#localApi.state,
            this.#localApi.writeStateFor(attachmentKey),
            this.#now,
          );
    const described = describeCapability(capability);
    if (this.#lastCapability.get(attachmentKey) === described) {
      logger.trace("Editing capability read", { attachmentKey, capability });
      return capability;
    }
    this.#lastCapability.set(attachmentKey, described);
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
  async #command(
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
    const expectedServerID = this.#localApi.demandSource()?.serverID ?? null;
    const generation = this.#commandGeneration;
    const held = this.#holding(annotationKey);
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
    const { client } = this.#queries;
    const mutation: AnnotationMutation = client
      .getMutationCache()
      .build(client, {
        mutationKey: [ANNOTATIONS, annotationKey, command.write],
        // One write per Annotation at a time, in the order they were asked for.
        scope: { id: JSON.stringify([ANNOTATIONS, annotationKey]) },
        // Zotero runs on this device, so no write waits for an online event.
        networkMode: "always",
        mutationFn: async () => {
          const send = () => this.#runCommand(annotationKey, queued);
          return await (command.run?.(send, mutation) ?? send());
        },
      });
    // The mutation holds its proposal from here on, so a surface redrawing on
    // this announcement draws it in the same task.
    this.#pendingStates.set(mutation, {
      kind: "pending",
      write: command.write,
      ...("session" in command && command.session && { session: true }),
    });
    const operation = mutation.execute(proposal);
    this.#operations.set(mutation, operation);
    if (proposal) {
      this.#emitter.emit("annotations-changed", proposal.attachmentKey);
    }
    this.#emitter.emit("annotation-changed", annotationKey);
    // A write that settles lets its proposal go: confirmed, the list already
    // holds the same value; refused, the confirmed value is drawn again. What
    // it left on the Annotation is announced in the same turn.
    const settled = () => {
      if (proposal) {
        this.#emitter.emit("annotations-changed", proposal.attachmentKey);
      }
      this.#emitter.emit("annotation-changed", annotationKey);
    };
    void operation.then(settled, settled);
    return await this.#counted(held?.attachmentKey, operation);
  }

  async #runCommand(
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
    if (command.generation !== this.#commandGeneration) {
      return { kind: "failed", failure: { kind: "unknown-outcome" } };
    }
    if (
      (this.#localApi.demandSource()?.serverID ?? null) !==
      command.expectedServerID
    ) {
      return { kind: "failed", failure: { kind: "server-changed" } };
    }
    const held = this.#holding(annotationKey);
    const parsed = parseIndexedKey(annotationKey);
    if (!held || !parsed) {
      return this.#leave(annotationKey, {
        kind: "failed",
        failure: { kind: "unknown-annotation" },
      });
    }
    if (!this.#compatibleApiSource(held.attachmentKey)) {
      return this.#leave(annotationKey, {
        kind: "failed",
        failure: { kind: "db-source" },
      });
    }
    const { version } = held.record;
    if (version === null) {
      return this.#leave(annotationKey, {
        kind: "failed",
        failure: { kind: "db-source" },
      });
    }

    // The write takes over the Annotation: a failure or conflict it left
    // before is over once this one runs.
    this.#outcomes.delete(annotationKey);
    const blocked = this.#writeBlocked(held.attachmentKey);
    if (blocked) {
      return this.#leave(annotationKey, {
        kind: "failed",
        failure: blocked,
      });
    }

    const library = libraryPath(parsed);
    const { path, method, headers, body } = command.request(
      { library, key: parsed.key, version },
      held.record,
    );
    const source = this.#compatibleApiSource(held.attachmentKey);
    const reply = await this.#localApi.authorizedSend(path, {
      library,
      method,
      headers,
      body,
    });
    if (
      !source ||
      !(await this.#apiSourceStillBound(held.attachmentKey, source))
    ) {
      if (
        this.#databaseSources.get(held.attachmentKey)?.database.serverID !==
        source?.serverID
      ) {
        return { kind: "failed", failure: { kind: "server-changed" } };
      }
      return this.#leave(annotationKey, {
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
      const refused = await this.#writeRefused(held, annotationKey, {
        ...command,
        failure: reply.failure,
      });
      if (refused.kind === "re-apply" && !command.reapplied) {
        logger.debug("A tag write applies its names again to fresh tags", {
          annotationKey,
        });
        return await this.#runCommand(annotationKey, {
          ...command,
          reapplied: true,
        });
      }
      const state: MutationState =
        refused.kind === "re-apply"
          ? { kind: "failed", failure: reply.failure }
          : refused;
      if (state.kind === "failed") await this.refresh(held.attachmentKey);
      this.#leave(annotationKey, state);
      if (state.kind === "conflict") {
        this.#emitter.emit("write-conflict", annotationKey, held.attachmentKey);
      }
      return state;
    }

    logger.debug("Zotero took a write", { annotationKey, method });
    this.#rememberAcknowledgedRevision(held.attachmentKey, reply.value.headers);
    const applied = await this.#applyWrite(held, annotationKey, {
      write: command.write,
      settle: command.settle ?? "re-read",
    });
    if ("failure" in applied) {
      await this.refresh(held.attachmentKey);
      return this.#leave(annotationKey, {
        kind: "failed",
        failure: applied.failure,
      });
    }
    if (command.settle === "drop") {
      this.#dropCommentDraft(annotationKey);
      const tags = this.tagDraftFor(annotationKey);
      if (tags) this.#dropTagDraft(tags);
    }
    this.#publishQuery(held.attachmentKey, held.queryKey);
    if (applied.value.kind === "deleted") {
      this.#reconcilePublishedDrafts(
        held.queryKey,
        held.attachmentKey,
        this.#publishedLists.get(held.attachmentKey) ?? null,
      );
    }
    await this.#refreshConfirmed(held.attachmentKey, applied.value);
    if (command.gather) {
      command.gather.writes.push({
        attachmentKey: held.attachmentKey,
        before: held.record,
        applied: applied.value,
      });
    } else {
      this.#recordStep(held.attachmentKey, held.record, {
        applied: applied.value,
        join: command.join,
      });
    }
    this.#announcePixels(held.record, applied.value, source);
    this.#emitter.emit("annotations-changed", held.attachmentKey);
    return this.#leave(annotationKey, IDLE);
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
  async #stepHistory(
    attachmentKey: string,
    direction: HistoryDirection,
  ): Promise<HistoryOutcome> {
    const history = this.#histories.get(attachmentKey);
    if (!history || this.#steppingAttachments.has(attachmentKey))
      return { kind: "idle" };
    if (this.#savePending(attachmentKey)) return { kind: "idle" };
    const step = history.peek(direction);
    if (!step || this.#beingEdited(step)) return { kind: "idle" };
    // An undo is a write, so it needs the Editing Capability like any other,
    // and the existing notice says why it did not run.
    if (this.#writeBlocked(attachmentKey)) return { kind: "blocked" };

    this.#steppingAttachments.add(attachmentKey);
    try {
      return await this.#takeStep(step, { attachmentKey, direction, history });
    } finally {
      this.#steppingAttachments.delete(attachmentKey);
      this.#emitter.emit("history-changed", attachmentKey);
    }
  }

  /**
   * Whether a step stands in this direction that a press would actually take:
   * what {@link AnnotationRepository.canUndo} and
   * {@link AnnotationRepository.canRedo} answer, and what every surface that
   * draws a verb reads.
   */
  #stepStands(attachmentKey: string, direction: HistoryDirection): boolean {
    const step = this.#histories.get(attachmentKey)?.peek(direction);
    return !!step && !this.#beingEdited(step);
  }

  /**
   * Whether an Annotation Draft stands on an Annotation this step changes: a
   * comment draft, or a tag draft, whether its editor is open or it is held
   * for Save tags with no editor. A draft is a session Zotero does not hold
   * yet. An open comment editor answers these keys with its own text undo,
   * and a tag draft ends by its save or its discard before a step is taken.
   */
  #beingEdited(step: HistoryStep): boolean {
    return step.changes.some(
      ({ annotationKey }) =>
        this.commentDraftFor(annotationKey) || this.tagDraftFor(annotationKey),
    );
  }

  /**
   * The field check and the write of one step. Every Annotation the step names
   * is compared before any of them is written, so a step that cannot be taken
   * whole is taken not at all.
   */
  async #takeStep(
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
      return await this.#takeExistenceStep(step, {
        attachmentKey,
        direction,
        history,
      });
    }
    if (step.kind === "tags") {
      return await this.#takeTagStep(step, {
        attachmentKey,
        direction,
        history,
      });
    }
    const checked: { change: HistoryChange; record: AnnotationRecord }[] = [];
    for (const change of step.changes) {
      const record = this.#holding(change.annotationKey)?.record;
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
      let outcome = await this.#stepWrite(annotationKey, change.before);
      if (
        outcome.kind === "conflict" &&
        stillHeldAfterConflict(change.after, outcome.conflict)
      ) {
        // The `412` re-read the Annotation and it still holds what the step
        // left there, so only the version moved: send the write once more.
        outcome = await this.#stepWrite(annotationKey, change.before);
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
        this.discardConflict(annotationKey);
        history.drop(direction, step);
        return { kind: "changed", annotationKey };
      }
      const settled = this.#holding(annotationKey)?.record;
      left.push({
        annotationKey,
        before,
        after:
          (settled ? historyFieldsOf(step.kind, settled) : null) ??
          change.before,
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
  async #stepWrite(
    annotationKey: string,
    fields: HistoryFields,
  ): Promise<MutationState> {
    this.#steppingWrites.add(annotationKey);
    try {
      if (fields.color !== undefined) {
        return await this.patchColor(annotationKey, fields.color);
      }
      if (fields.comment !== undefined) {
        return await this.patchComment(annotationKey, fields.comment);
      }
      if (fields.geometry !== undefined) {
        // A step's own write joins nothing: the step it leaves behind is
        // already the one that steps it back.
        return await this.patchGeometry(
          annotationKey,
          fields.geometry,
          "pointer",
        );
      }
      return IDLE;
    } finally {
      this.#steppingWrites.delete(annotationKey);
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
  async #takeTagStep(
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
    const record = this.#holding(annotationKey)?.record;
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
    this.#steppingWrites.add(annotationKey);
    let outcome: MutationState;
    try {
      outcome = await this.#command(annotationKey, {
        write: "tags",
        request: (target, against) => {
          sent = against;
          return tagsPatch(target, mergeTags(annotationTags(against), reverse));
        },
        propose: (against) =>
          proposedTags(mergeTags(annotationTags(against), reverse)),
      });
    } finally {
      this.#steppingWrites.delete(annotationKey);
    }
    history.drop(direction, step);
    if (outcome.kind === "failed") {
      return { kind: "failed", failure: outcome.failure };
    }
    const settled = this.#holding(annotationKey)?.record;
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
  async #takeExistenceStep(
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
      const record = this.#holding(change.annotationKey)?.record ?? null;
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
        const erased = await this.deleteAnnotation(change.annotationKey);
        if (erased.kind === "failed") {
          return { kind: "failed", failure: erased.failure };
        }
        if (erased.kind !== "idle") {
          this.discardConflict(change.annotationKey);
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
      const made = await this.createAnnotation(attachmentKey, wanted);
      if (made.kind === "failed") {
        return { kind: "failed", failure: made.failure };
      }
      // Zotero named the restored Annotation itself, so every step of both
      // stacks that asked after the old key asks after this one now.
      history.rename(change.annotationKey, made.annotationKey);
      const settled = this.#holding(made.annotationKey)?.record ?? null;
      left.push({
        annotationKey: made.annotationKey,
        before: { content: null },
        after: { content: (settled && contentOf(settled)) ?? wanted },
      });
    }

    history.push(opposite(direction), { ...step, changes: left });
    if (removed) return { kind: "removed", ...removed };
    return { kind: "stepped", annotationKey: left[0]!.annotationKey };
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
  #recordStep(
    attachmentKey: string,
    before: AnnotationRecord,
    { applied, join }: { applied: ConfirmedWrite; join?: HistoryJoin },
  ): void {
    const history = this.#histories.get(attachmentKey);
    if (!history || this.#steppingWrites.has(before.key)) return;
    if (applied.kind === "record" && applied.write === "tags") {
      this.#recordTagStep(history, {
        attachmentKey,
        before,
        record: applied.record,
      });
      return;
    }
    if (applied.kind === "record" && applied.write === "comment") {
      this.#recordCommentStep(history, {
        attachmentKey,
        before,
        record: applied.record,
      });
      return;
    }
    const made = historyChangeOf(before, applied);
    if (!made) return;
    if (made.kind === "existence") {
      this.#recordExistence(attachmentKey, made.change);
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
    this.#emitter.emit("history-changed", attachmentKey);
  }

  /**
   * Take one confirmed comment write into the step its editing session is
   * shaping. One comment editing session is one History Step: the first save
   * of a session records the step from the text the comment held when the
   * session began, every later save moves only its `after`, and a session that
   * settles on the text it began with leaves no step at all.
   *
   * The session is read off the history rather than off the Annotation Draft,
   * which the repository drops and remakes around each settled save: a comment
   * write joins the step on top where that step is this Annotation's own
   * comment and the write was stamped off the text it left in Zotero, and
   * starts a fresh one otherwise. So a colour pick between two comment
   * sessions keeps them apart, a comment changed in Zotero between two saves
   * keeps them apart too, and the Mark Popup handing the editor to an
   * Annotation Card keeps them one.
   */
  #recordCommentStep(
    history: AnnotationHistory,
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
    const top = history.peek("undo");
    const open =
      top?.kind === "comment" &&
      top.changes.length === 1 &&
      top.changes[0]!.annotationKey === record.key &&
      // The write was stamped off the very text that step left in Zotero, so
      // the two saves are one session. A comment changed in Zotero between
      // them moves the record the next write is stamped off: that session is
      // over, and a fresh step starts holding the foreign text, so one press
      // puts that back rather than the text the session began with.
      sameComment(before.comment, top.changes[0]!.after.comment ?? null)
        ? top
        : null;
    // A step's own `before` never moves, so the session reads its starting
    // text from there rather than from the draft's baseline, which the last
    // save advanced.
    const origin = open?.changes[0]!.before.comment ?? before.comment ?? "";
    const after = record.comment ?? "";
    const step: HistoryStep | null = sameComment(origin, after)
      ? null
      : {
          kind: "comment",
          changes: [
            {
              annotationKey: record.key,
              before: { comment: origin },
              after: { comment: after },
            },
          ],
        };
    if (open) history.reshape(open, step);
    else if (step) history.record(step);
    else return;
    logger.debug("A comment session moved in the annotation history", {
      attachmentKey,
      annotationKey: record.key,
      recorded: !!step,
    });
    this.#emitter.emit("history-changed", attachmentKey);
  }

  /**
   * Take one confirmed tag session into the Attachment's Annotation History,
   * as one step holding the names it added and removed with their types. The
   * names are read off the two records around the write, so a session whose
   * names Zotero already held leaves no step.
   *
   * @see apps/obsidian/docs/adr/0063-annotation-tags-save-once-per-editing-session-and-merge-by-name.md
   */
  #recordTagStep(
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
    this.#emitter.emit("history-changed", attachmentKey);
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
  #recordGroup(
    attachmentKey: string,
    annotationKeys: readonly string[],
    { kind, writes }: GroupWrites,
  ): void {
    const history = this.#histories.get(attachmentKey);
    if (!history || this.#steppingAttachments.has(attachmentKey)) return;
    const order = (entry: GroupWrite) =>
      annotationKeys.indexOf(entry.before.key);
    const changes: HistoryChange[] = [];
    for (const { before, applied } of writes.toSorted(
      (a, b) => order(a) - order(b),
    )) {
      if (this.#steppingWrites.has(before.key)) continue;
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
    this.#emitter.emit("history-changed", attachmentKey);
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
  #recordExistence(
    attachmentKey: string,
    change: HistoryChange,
    group?: string,
  ): void {
    const history = this.#histories.get(attachmentKey);
    if (!history || this.#steppingAttachments.has(attachmentKey)) return;
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
    this.#emitter.emit("history-changed", attachmentKey);
  }

  /**
   * Whether a save on this Attachment is on its way or still due: a write in
   * flight, or an Annotation Draft whose autosave timer is armed. A press of
   * the Annotation History's keys does nothing while one stands, rather than
   * stepping past a save that would then land on top of it.
   */
  #savePending(attachmentKey: string): boolean {
    if ((this.#writesInFlight.get(attachmentKey) ?? 0) > 0) return true;
    for (const draft of this.#commentDrafts.values()) {
      if (draft.attachmentKey !== attachmentKey) continue;
      const save = this.#commentSaves.get(
        commentDraftID(draft.serverID, draft.annotationKey),
      );
      if (!save) continue;
      if (save.idleTimer !== null || save.burstTimer !== null) return true;
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
  async #counted<T>(
    attachmentKey: string | undefined,
    work: Promise<T>,
  ): Promise<T> {
    if (attachmentKey === undefined) return await work;
    this.#writesInFlight.set(
      attachmentKey,
      (this.#writesInFlight.get(attachmentKey) ?? 0) + 1,
    );
    try {
      return await work;
    } finally {
      const left = (this.#writesInFlight.get(attachmentKey) ?? 1) - 1;
      if (left > 0) this.#writesInFlight.set(attachmentKey, left);
      else this.#writesInFlight.delete(attachmentKey);
    }
  }

  /**
   * Announce a saved record whose pixels moved, so an Excerpt Image made from
   * the record that stood before it is replaced rather than shown.
   *
   * The comparison is the canonical pixel fingerprint, so a re-read that
   * answers the same pixels — Zotero echoes a colour the user picked — is not a
   * change at all.
   */
  #announcePixels(
    before: AnnotationRecord,
    applied: ConfirmedWrite,
    source: AnnotationSource,
  ): void {
    if (applied.kind !== "record") return;
    if (excerptFingerprint(before) === excerptFingerprint(applied.record))
      return;
    this.#emitter.emit("excerpt-pixels-changed", applied.record, source);
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
  async #announceReadPixels(
    superseded: AnnotationList | undefined,
    candidate: AnnotationList,
  ): Promise<void> {
    const stood = superseded
      ? fingerprintMap(superseded)
      : await this.#persistedFingerprints(candidate);
    for (const record of candidate.annotations) {
      const fingerprint = stood.get(record.key);
      if (
        fingerprint === undefined ||
        fingerprint === excerptFingerprint(record)
      )
        continue;
      this.#emitter.emit("excerpt-pixels-changed", record, candidate.source);
    }
  }

  /**
   * The pixels this device's persisted Excerpt Image of each of one Attachment's
   * Annotations was made from, as the baseline a session's first read is
   * compared against. An Annotation this device never cached answers nothing, so
   * it stays on demand.
   */
  async #persistedFingerprints(
    candidate: AnnotationList,
  ): Promise<ReadonlyMap<string, string>> {
    const persisted = this.#persistedExcerpt;
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

  #writeBlocked(attachmentKey: string): WriteFailure | null {
    const capability = this.#capability(attachmentKey);
    switch (capability.kind) {
      case "writable":
        return null;
      case "authorization-required":
      case "authorizing":
        return { kind: "unauthorized" };
      case "cooldown":
        return {
          kind: "cooldown",
          retryAfter: this.#now().until(capability.retryAfter),
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
  async #writeRefused(
    held: HeldAnnotation,
    annotationKey: string,
    refusal: WriteAttempt & { failure: WriteFailure },
  ): Promise<MutationState | { kind: "re-apply" }> {
    const { failure } = refusal;
    if (failure.kind === "not-found") {
      this.#dropAttachment(held.attachmentKey, held.queryKey);
      return { kind: "failed", failure };
    }
    if (failure.kind !== "conflict") return { kind: "failed", failure };

    const fresh = await this.#localApi.readAnnotation(
      annotationKey,
      held.attachmentKey,
    );
    if ("failure" in fresh) {
      logger.debug("A conflicted annotation could not be read back", {
        annotationKey,
        failure: fresh.failure,
      });
      this.#dropAttachment(held.attachmentKey, held.queryKey);
      return {
        kind: "failed",
        failure: fresh.failure.kind === "not-found" ? fresh.failure : failure,
      };
    }

    const record = fromLocalApi(fresh.value);
    // The fresh record replaces the stale one before the list is dropped, so
    // "Apply again" sends the version Zotero holds rather than repeating the
    // precondition that just failed.
    this.#queries.update<AnnotationList>(held.queryKey, (list) => ({
      ...list,
      annotations: list.annotations.map((stale) =>
        stale.key === annotationKey ? record : stale,
      ),
    }));
    this.#dropAttachment(held.attachmentKey, held.queryKey);

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
  async #applyWrite(
    held: HeldAnnotation,
    annotationKey: string,
    {
      write,
      settle,
    }: { write: ConflictedWrite | "tags"; settle: "re-read" | "drop" },
  ): Promise<{ value: ConfirmedWrite } | { failure: LocalApiFailure }> {
    const { queryKey, attachmentKey } = held;
    if (settle === "drop") {
      this.#queries.update<AnnotationList>(queryKey, (list) => ({
        ...list,
        annotations: list.annotations.filter(
          (record) => record.key !== annotationKey,
        ),
      }));
      return { value: { kind: "deleted", annotationKey } };
    }
    const fresh = await this.#localApi.readAnnotation(
      annotationKey,
      attachmentKey,
    );
    if ("failure" in fresh) {
      logger.debug("A written annotation could not be read back", {
        annotationKey,
        failure: fresh.failure,
      });
      this.#queries.invalidate(queryKey);
      return fresh;
    }
    const record = fromLocalApi(fresh.value);
    this.#queries.update<AnnotationList>(queryKey, (list) => ({
      ...list,
      annotations: list.annotations.map((stale) =>
        stale.key === annotationKey ? record : stale,
      ),
    }));
    return {
      value: {
        kind: "record",
        record,
        write: write === "delete" ? "color" : write,
      },
    };
  }

  /** Retain one successful API confirmation before a later refresh can fail. */
  #publishQuery(attachmentKey: string, queryKey: QueryKey): void {
    const confirmed = this.#queries.peek<AnnotationList>(queryKey)?.value;
    if (!confirmed || !this.#canPublish(attachmentKey, confirmed, queryKey)) {
      return;
    }
    this.#publishedLists.set(attachmentKey, confirmed);
    this.#publishedStatuses.set(attachmentKey, "fresh");
  }

  /** Revalidate the collection without replacing a newer write confirmation. */
  async #refreshConfirmed(
    attachmentKey: string,
    confirmation: ConfirmedWrite,
  ): Promise<void> {
    const held = this.#confirmedWrites.get(attachmentKey) ?? [];
    this.#confirmedWrites.set(attachmentKey, [
      ...held.filter(
        (existing) =>
          confirmationKey(existing) !== confirmationKey(confirmation),
      ),
      confirmation,
    ]);
    await this.refresh(attachmentKey);
  }

  /**
   * The list the active Annotation Source holds this Annotation in, and the
   * record itself. Only the active source's partition is walked: the card that
   * offered the gesture is showing that source's list, and it is that record's
   * version a write must send.
   */
  #holding(annotationKey: string): HeldAnnotation | null {
    const source = this.#localApi.demandSource();
    const prefix = source
      ? [ANNOTATIONS, ZOTERO_LOCAL_API, source.serverID]
      : [ANNOTATIONS, ZOTERO_DB];
    for (const queryKey of this.#queries.keysUnder(prefix)) {
      const list = this.#queries.peek<AnnotationList>(queryKey)?.value;
      const attachmentKey = queryKey.at(-1);
      if (
        !list ||
        typeof attachmentKey !== "string" ||
        !this.#canPublish(attachmentKey, list, queryKey)
      ) {
        continue;
      }
      const record = list?.annotations.find(
        (annotation) => annotation.key === annotationKey,
      );
      if (record) {
        return { queryKey, attachmentKey, record };
      }
    }
    return null;
  }

  /**
   * One Attachment's list is superseded: it goes, and the Attachment is
   * announced. The only signal a consumer replaces a list on.
   *
   * @param queryKey the partition key the caller already holds; the active
   *   partition's own key where it does not.
   */
  #dropAttachment(attachmentKey: string, queryKey?: QueryKey): void {
    this.#queries.invalidate(
      queryKey ?? this.#activePartition(attachmentKey).queryKey,
    );
    this.#emitter.emit("annotations-changed", attachmentKey);
  }

  /** Records the outcome one Annotation is left with, and announces it. */
  #settle(annotationKey: string, state: MutationState): MutationState {
    this.#leave(annotationKey, state);
    this.#emitter.emit("annotation-changed", annotationKey);
    return state;
  }

  /**
   * Records the outcome a running write leaves on its Annotation. The write's
   * own settle announces it, once the mutation cache no longer holds it
   * pending.
   */
  #leave(annotationKey: string, state: MutationState): MutationState {
    if (state.kind === "failed" || state.kind === "conflict") {
      this.#outcomes.set(annotationKey, state);
    } else {
      this.#outcomes.delete(annotationKey);
    }
    return state;
  }

  #setCommentDraft(draft: CommentDraft, state: CommentDraftState): void {
    this.#commentDrafts.set(
      commentDraftID(draft.serverID, draft.annotationKey),
      {
        ...draft,
        state,
      },
    );
    this.#commentDraftSources.set(draft.annotationKey, draft.serverID);
    this.#emitter.emit("annotation-changed", draft.annotationKey);
  }

  #dropCommentDraft(annotationKey: string, serverID?: string): void {
    const activeServerID = serverID ?? this.#localApi.demandSource()?.serverID;
    if (
      !activeServerID ||
      !this.#commentDrafts.delete(commentDraftID(activeServerID, annotationKey))
    ) {
      return;
    }
    if (this.#commentDraftSources.get(annotationKey) === activeServerID) {
      this.#commentDraftSources.delete(annotationKey);
    }
    this.#cancelCommentSave(annotationKey, activeServerID);
    this.#emitter.emit("annotation-changed", annotationKey);
  }

  #setTagDraft(draft: TagDraft): void {
    this.#tagDrafts.set(
      commentDraftID(draft.serverID, draft.annotationKey),
      draft,
    );
    this.#tagDraftSources.set(draft.annotationKey, draft.serverID);
    this.#emitter.emit("annotation-changed", draft.annotationKey);
  }

  #dropTagDraft({ serverID, annotationKey }: TagDraft): void {
    if (!this.#tagDrafts.delete(commentDraftID(serverID, annotationKey)))
      return;
    if (this.#tagDraftSources.get(annotationKey) === serverID) {
      this.#tagDraftSources.delete(annotationKey);
    }
    this.#emitter.emit("annotation-changed", annotationKey);
  }

  #commentSave(id: string): CommentSave {
    const standing = this.#commentSaves.get(id);
    if (standing) return standing;
    const save: CommentSave = { idleTimer: null, burstTimer: null };
    this.#commentSaves.set(id, save);
    return save;
  }

  #canAutosave(
    draft: Pick<CommentDraft, "attachmentKey" | "manualSave">,
  ): boolean {
    const capability = this.capabilityFor(draft.attachmentKey);
    return !draft.manualSave && capability.kind === "writable";
  }

  #scheduleCommentSave(draft: CommentDraft): void {
    const id = commentDraftID(draft.serverID, draft.annotationKey);
    const save = this.#commentSave(id);
    // Text typed behind a save in flight is sent once that save lands.
    if (this.#savingComment(draft.annotationKey)) return;
    if (!this.#canAutosave(draft)) return;
    if (sameComment(draft.text, draft.baseline)) return;
    if (save.idleTimer !== null) clearTimeout(save.idleTimer);
    save.idleTimer = setTimeout(() => {
      save.idleTimer = null;
      void this.submitComment(draft.annotationKey, { automatic: true });
    }, COMMENT_IDLE_SAVE_MS);
    save.burstTimer ??= setTimeout(() => {
      save.burstTimer = null;
      void this.submitComment(draft.annotationKey, { automatic: true });
    }, COMMENT_BURST_SAVE_MS);
  }

  #clearCommentTimers(save: CommentSave): void {
    if (save.idleTimer !== null) clearTimeout(save.idleTimer);
    if (save.burstTimer !== null) clearTimeout(save.burstTimer);
    save.idleTimer = null;
    save.burstTimer = null;
  }

  #cancelCommentSave(annotationKey: string, serverID?: string): void {
    const activeServerID =
      serverID ?? this.#commentDraftSources.get(annotationKey);
    if (!activeServerID) return;
    const id = commentDraftID(activeServerID, annotationKey);
    const save = this.#commentSaves.get(id);
    if (!save) return;
    this.#clearCommentTimers(save);
    this.#commentSaves.delete(id);
  }

  #cancelAllCommentSaves(): void {
    for (const save of this.#commentSaves.values()) {
      this.#clearCommentTimers(save);
    }
  }

  /** Reconcile drafts only against a complete read from their own database. */
  #reconcileDrafts(
    serverID: string,
    attachmentKey: string,
    annotations: readonly AnnotationRecord[],
  ): void {
    const records = new Map(annotations.map((record) => [record.key, record]));
    const completeID = commentDraftID(serverID, attachmentKey);
    const before = this.#completeKeys.get(completeID);
    this.#completeKeys.set(completeID, new Set(records.keys()));
    // Gone is what the last complete read showed, or a draft stands on, and
    // this one no longer answers.
    const gone = new Set(
      [
        ...(before ?? []),
        ...[...this.#commentDrafts.values(), ...this.#tagDrafts.values()]
          .filter(
            (draft) =>
              draft.serverID === serverID &&
              draft.attachmentKey === attachmentKey,
          )
          .map((draft) => draft.annotationKey),
      ].filter((key) => !records.has(key)),
    );
    for (const key of records.keys()) this.#gone.delete(key);
    for (const key of gone) this.#gone.add(key);
    // Deletion confirmed in Zotero discards the tag draft with the comment
    // draft; the gone Annotation is announced below.
    for (const draft of this.#tagDrafts.values()) {
      if (
        draft.serverID !== serverID ||
        draft.attachmentKey !== attachmentKey ||
        records.has(draft.annotationKey)
      )
        continue;
      this.#dropTagDraft(draft);
    }
    for (const draft of this.#commentDrafts.values()) {
      if (
        draft.serverID !== serverID ||
        draft.attachmentKey !== attachmentKey
      ) {
        continue;
      }
      const record = records.get(draft.annotationKey);
      if (!record) {
        this.#dropCommentDraft(draft.annotationKey, serverID);
        continue;
      }
      const fresh = record.comment ?? "";
      if (draft.state.kind === "pending") {
        if (
          this.#pendingWrites(draft.annotationKey).some(
            ({ options, state }) =>
              options.mutationKey?.[2] === "comment" &&
              sameComment(fresh, state.variables?.fields.comment ?? null),
          )
        ) {
          this.#commentDrafts.set(
            commentDraftID(serverID, draft.annotationKey),
            { ...draft, baseline: fresh },
          );
          this.#emitter.emit("annotation-changed", draft.annotationKey);
        }
        continue;
      }
      if (sameComment(fresh, draft.text)) {
        this.#dropCommentDraft(draft.annotationKey, serverID);
        continue;
      }
      if (sameComment(fresh, draft.baseline)) continue;
      if (sameComment(draft.text, draft.baseline)) {
        this.#commentDrafts.set(commentDraftID(serverID, draft.annotationKey), {
          ...draft,
          baseline: fresh,
          text: fresh,
          state: { kind: "editing" },
        });
        this.#emitter.emit("annotation-changed", draft.annotationKey);
        continue;
      }
      const conflict: MutationState = {
        kind: "conflict",
        conflict: { write: "comment", attempted: draft.text, fresh },
      };
      this.#settle(draft.annotationKey, conflict);
      this.#commentDrafts.set(
        commentDraftID(draft.serverID, draft.annotationKey),
        {
          ...draft,
          state: { kind: "conflict", fresh },
        },
      );
      this.#emitter.emit("annotation-changed", draft.annotationKey);
      this.#emitter.emit("write-conflict", draft.annotationKey, attachmentKey);
    }
    // What a write left on an Annotation goes with it, and every surface
    // still drawing it hears that it is gone, with a draft or without.
    for (const key of gone) {
      this.#outcomes.delete(key);
      this.#emitter.emit("annotation-changed", key);
    }
  }

  /** Reconcile only a complete result Query Core accepted for publication. */
  #reconcilePublishedDrafts(
    queryKey: QueryKey,
    attachmentKey: string,
    list: AnnotationList | null,
  ): void {
    if (!list) return;
    const held = this.#queries.peek<AnnotationList>(queryKey);
    if (held?.status !== "fresh" || held.value !== list) return;
    const serverID =
      list.source.kind === "zotero-local-api"
        ? list.source.serverID
        : list.source.database.serverID;
    if (serverID === null) return;
    this.#reconcileDrafts(serverID, attachmentKey, list.annotations);
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
  #activePartition(attachmentKey: string): AnnotationPartition {
    const source = this.#compatibleApiSource(attachmentKey);
    if (source) {
      return {
        queryKey: [
          ANNOTATIONS,
          ZOTERO_LOCAL_API,
          source.serverID,
          attachmentKey,
        ],
        read: ({ signal }) =>
          this.#readFromLocalApi(source, attachmentKey, signal),
      };
    }
    return {
      queryKey: [
        ANNOTATIONS,
        ZOTERO_DB,
        this.#databaseGeneration,
        attachmentKey,
      ],
      read: () => this.#readFromDatabase(attachmentKey),
    };
  }

  /**
   * @throws {LocalApiReadFailed} where the Zotero Local API did not answer the
   *   list. The client has already stood its session down by then, so the
   *   Attachment's next ask lands on the source that can answer.
   */
  async #readFromLocalApi(
    source: LocalApiSource,
    attachmentKey: string,
    signal: AbortSignal,
  ): Promise<AnnotationList> {
    const result = await this.#localApi.listAnnotations(attachmentKey, signal);
    if ("failure" in result) throw new LocalApiReadFailed(result.failure);
    return { source, annotations: result.value.map(fromLocalApi) };
  }

  async #readFromDatabase(attachmentKey: string): Promise<AnnotationList> {
    using lease = await this.#db.acquireRead();
    const annotations = readAttachmentAnnotations(lease.client, attachmentKey);
    const source = databaseAnnotationSource(lease.client, attachmentKey);
    logger.debug("Annotations read from the Zotero database", {
      attachmentKey,
      annotations: annotations.length,
    });
    return { source, annotations };
  }

  #adoptDatabaseSource(
    attachmentKey: string,
    source: DatabaseAnnotationSource,
  ): void {
    const previous = this.#databaseSources.get(attachmentKey);
    const previousServerID = this.#databaseServerIDs.get(attachmentKey);
    this.#databaseSources.set(attachmentKey, source);
    this.#databaseServerIDs.set(attachmentKey, source.database.serverID);
    if (
      previousServerID !== undefined &&
      previousServerID !== source.database.serverID
    ) {
      for (const draft of this.#commentDrafts.values()) {
        if (
          draft.attachmentKey === attachmentKey &&
          draft.serverID !== source.database.serverID &&
          this.#commentDraftSources.get(draft.annotationKey) === draft.serverID
        ) {
          this.#commentDraftSources.delete(draft.annotationKey);
          this.#cancelCommentSave(draft.annotationKey, draft.serverID);
          this.#emitter.emit("annotation-changed", draft.annotationKey);
        }
      }
      for (const draft of this.#tagDrafts.values()) {
        if (
          draft.attachmentKey === attachmentKey &&
          draft.serverID !== source.database.serverID &&
          this.#tagDraftSources.get(draft.annotationKey) === draft.serverID
        ) {
          this.#tagDraftSources.delete(draft.annotationKey);
          this.#emitter.emit("annotation-changed", draft.annotationKey);
        }
      }
      for (const { key } of this.#publishedLists.get(attachmentKey)
        ?.annotations ?? []) {
        if (this.#outcomes.delete(key)) {
          this.#emitter.emit("annotation-changed", key);
        }
      }
      this.#confirmedWrites.delete(attachmentKey);
    }
    if (!databaseSourcesEqual(previous, source)) {
      queueMicrotask(() => {
        this.#emitter.emit("capability-changed");
        if (this.#compatibleApiSource(attachmentKey)) {
          this.#emitter.emit("annotations-changed", attachmentKey);
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
  #sourceMoved(): void {
    this.#queries.invalidate([ANNOTATIONS, ZOTERO_LOCAL_API]);
    const held = this.#attachmentsHeld([ANNOTATIONS]);
    const source = this.#localApi.demandSource();
    logger.debug("The Zotero Local API source moved", {
      attachments: held.length,
      source,
    });
    for (const attachmentKey of held) {
      this.#emitter.emit("annotations-changed", attachmentKey);
    }
    this.#rereadSuperseded(held);
  }

  /**
   * Every Attachment one prefix holds a list for. Both partitions key by
   * Indexed Key last — the Zotero Local API one behind its server id — so the
   * last element names the Attachment whichever source answered.
   */
  #attachmentsHeld(prefix: QueryKey): string[] {
    const keys = this.#queries
      .keysUnder(prefix)
      .map((queryKey) => queryKey.at(-1))
      .filter((key) => typeof key === "string");
    return [...new Set(keys)];
  }

  /**
   * A refreshed database replaces every row the partition held, so the whole
   * partition goes rather than the rows a comparison would call changed.
   */
  #dropDatabasePartition(): void {
    this.#databaseGeneration += 1;
    this.#databaseSources.clear();
    const prefix = [ANNOTATIONS, ZOTERO_DB];
    const held = this.#attachmentsHeld(prefix);
    this.#queries.invalidate(prefix);
    logger.debug("Zotero database annotation partition dropped", {
      attachments: held.length,
    });
    for (const attachmentKey of held) {
      this.#emitter.emit("annotations-changed", attachmentKey);
    }
    this.#rereadSuperseded(held);
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
   * Whether this device holds an image for an Annotation is not this
   * repository's to know: the consumer resolves that against its own store, so
   * one this device never cached stays on demand.
   */
  #rereadSuperseded(announced: readonly string[]): void {
    for (const attachmentKey of new Set([
      ...announced,
      ...this.#publishedLists.keys(),
    ])) {
      void this.read(attachmentKey).catch((error: unknown) => {
        logger.debug("A superseded Attachment was not read again", {
          attachmentKey,
          error,
        });
      });
    }
  }

  /** The published list as surfaces draw it: with every Pending Proposal. */
  #published(attachmentKey: string): Held<AnnotationList> | null {
    const confirmed = this.#publishedLists.get(attachmentKey);
    const value = confirmed && this.#withProposals(attachmentKey, confirmed);
    return value
      ? {
          value,
          status: this.#publishedStatuses.get(attachmentKey) ?? "fresh",
          settled: Promise.resolve(value),
        }
      : null;
  }

  /** The writes on one Annotation still in flight or waiting, oldest first. */
  #pendingWrites(annotationKey: string): AnnotationMutation[] {
    return this.#queries.client.getMutationCache().findAll({
      mutationKey: [ANNOTATIONS, annotationKey],
      status: "pending",
    }) as AnnotationMutation[];
  }

  /** The latest comment write on one Annotation still in flight or waiting. */
  #savingComment(annotationKey: string): AnnotationMutation | undefined {
    return this.#pendingWrites(annotationKey).findLast(
      ({ options }) => options.mutationKey?.[2] === "comment",
    );
  }

  /** What a write in flight answers, for a caller that joins it. */
  #answerOf(mutation: AnnotationMutation): Promise<MutationState> {
    return (
      this.#operations.get(mutation) ??
      Promise.resolve(
        this.mutationFor(String(mutation.options.mutationKey?.[1])),
      )
    );
  }

  /**
   * One confirmed list with the Pending Proposal of every write in flight on
   * its Annotations drawn over it, the later write's field over the earlier's.
   * A proposal is drawn only over the list of the Zotero database it was sent
   * to. The list itself is answered while nothing is proposed.
   */
  #withProposals(attachmentKey: string, list: AnnotationList): AnnotationList {
    if (list.source.kind !== "zotero-local-api") return list;
    const { serverID } = list.source;
    const proposed = new Map<string, ProposedFields>();
    for (const mutation of this.#queries.client
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

  #compatibleApiSource(attachmentKey: string | null): LocalApiSource | null {
    const api = this.#localApi.demandSource();
    if (!api) return null;
    const sources =
      attachmentKey === null
        ? this.#databaseSources.values()
        : [this.#databaseSources.get(attachmentKey)].values();
    for (const source of sources) {
      if (source?.database.serverID === api.serverID) return api;
    }
    return null;
  }

  #sameApiSource(attachmentKey: string, expected: LocalApiSource): boolean {
    return (
      this.#compatibleApiSource(attachmentKey)?.serverID === expected.serverID
    );
  }

  async #apiSourceStillBound(
    attachmentKey: string,
    expected: LocalApiSource,
  ): Promise<boolean> {
    if (this.#sameApiSource(attachmentKey, expected)) return true;
    if (this.#localApi.demandSource()?.serverID !== expected.serverID) {
      return false;
    }
    const generation = this.#databaseGeneration;
    const { source } = await this.#readFromDatabase(attachmentKey);
    const verified =
      generation === this.#databaseGeneration &&
      source.kind === "zotero-db" &&
      source.database.serverID === expected.serverID &&
      this.#localApi.demandSource()?.serverID === expected.serverID;
    if (verified) this.#adoptDatabaseSource(attachmentKey, source);
    return verified;
  }

  #canPublish(
    attachmentKey: string,
    candidate: AnnotationList,
    queryKey?: QueryKey,
  ): boolean {
    if (candidate.source.kind === "zotero-local-api") {
      return (
        this.#sameApiSource(attachmentKey, candidate.source) &&
        coversConfirmations(candidate, this.#confirmedWrites.get(attachmentKey))
      );
    }
    const { source } = candidate;
    if (
      queryKey?.[1] === ZOTERO_DB &&
      queryKey[2] !== this.#databaseGeneration
    ) {
      return false;
    }
    const floor = this.#acknowledgedRevisions.get(databaseLibraryKey(source));
    return (
      floor === undefined ||
      (source.libraryRevision !== null && source.libraryRevision >= floor)
    );
  }

  #rememberAcknowledgedRevision(attachmentKey: string, headers: Headers): void {
    const source = this.#databaseSources.get(attachmentKey);
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
      this.#acknowledgedRevisions.set(key, Number.POSITIVE_INFINITY);
      return;
    }
    const held = this.#acknowledgedRevisions.get(key) ?? -1;
    if (value > held) this.#acknowledgedRevisions.set(key, value);
  }
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

function commentDraftID(serverID: string, annotationKey: string): string {
  return `${serverID}\0${annotationKey}`;
}

/** One list's canonical pixel fingerprints, by Indexed Key. */
function fingerprintMap(list: AnnotationList): ReadonlyMap<string, string> {
  return new Map(
    list.annotations.map((record) => [record.key, excerptFingerprint(record)]),
  );
}

function sameComment(a: string | null, b: string | null): boolean {
  return (a ?? "") === (b ?? "");
}

function coversConfirmation(
  list: AnnotationList | undefined,
  confirmation: ConfirmedWrite | undefined,
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
  if (confirmation.kind === "created") return true;
  return (
    freshValueOf(candidate, confirmation.write) ===
    freshValueOf(confirmation.record, confirmation.write)
  );
}

function coversConfirmations(
  list: AnnotationList | undefined,
  confirmations: readonly ConfirmedWrite[] | undefined,
): boolean {
  return (
    confirmations?.every((confirmation) =>
      coversConfirmation(list, confirmation),
    ) ?? true
  );
}

function confirmationKey(confirmation: ConfirmedWrite): string {
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

/** What Zotero holds now for the field one refused write asked to change. */
function freshValueOf(
  record: AnnotationRecord,
  write: ConflictedWrite | "tags",
): string | null {
  switch (write) {
    case "color":
      return record.color;
    case "comment":
      return record.comment;
    // A delete names no value, so there is nothing to put beside the user's
    // input; the fresh card itself is what "Delete anyway" is asked against.
    case "delete":
      return null;
    // The stored position and the quoted text, as one comparable value.
    case "geometry":
      return JSON.stringify([storedPosition(record.position), record.text]);
    case "tags":
      return JSON.stringify(annotationTags(record));
  }
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

/** A merged tag list as the record Zotero answers after the write holds it. */
function proposedTags(tags: readonly AnnotationTag[]): ProposedFields {
  return { tags: tags.map(({ name }) => name), tagDetails: tags };
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

/**
 * The Zotero DB read path, and the only place the numeric item id and the
 * parent's content type are read: `parseAnnotationPosition` narrows the stored
 * JSON by the Attachment's content type, which the Annotation row itself
 * does not carry.
 *
 * @returns an empty list for a key the database does not hold, so an index that
 *   named an Attachment the database has since dropped reads as no Annotations
 *   rather than as a failure.
 */
function readAttachmentAnnotations(
  client: NodeDatabaseClient,
  attachmentKey: string,
): readonly AnnotationRecord[] {
  const library = resolveIndexedKeyLibrary(client, attachmentKey);
  const attachment =
    library && getAttachmentByKey(client, library.key, library.libraryID);
  if (!attachment) {
    logger.debug("No Zotero attachment answers this key", { attachmentKey });
    return [];
  }
  const contentType = attachment.contentType ?? "";
  return getAnnotationsByParent(client, attachment.itemID).map((annotation) =>
    toRecord(annotation, { attachmentKey, contentType }),
  );
}

function databaseAnnotationSource(
  client: NodeDatabaseClient,
  attachmentKey: string,
): DatabaseAnnotationSource {
  const target = resolveIndexedKeyLibrary(client, attachmentKey);
  if (!target)
    throw new Error(
      `Cannot resolve the Annotation Library for ${attachmentKey}`,
    );
  const library = getLibraries(client).find(
    ({ libraryID }) => libraryID === target.libraryID,
  );
  const database = getZoteroDatabaseIdentity(client);
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
  }: { attachmentKey: string; contentType: string },
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
    templateMetadata: {
      dateAdded: annotation.dateAdded.toString(),
      dateModified: annotation.dateModified.toString(),
      authorName: annotation.authorName,
      isExternal: annotation.isExternal,
      tags: templateTags(annotation.tagDetails),
    },
  };
}

/** Tags with their types named, as a template reads them from either source. */
function templateTags(tags: readonly AnnotationTag[] | undefined) {
  return tags?.map(({ name, type }) => ({ name, type: tagTypeToName(type) }));
}

/** The Sort Index comes across: it orders the list, and a restore sends it back. */
function fromLocalApi({
  key,
  type,
  color,
  comment,
  text,
  parentKey,
  pageLabel,
  sortIndex,
  tags,
  position,
  version,
  dateAdded,
  dateModified,
  authorName,
  isExternal,
  tagDetails,
}: LocalApiAnnotation): AnnotationRecord {
  return {
    key,
    type,
    color,
    comment,
    text,
    parentKey,
    pageLabel,
    sortIndex,
    tags,
    tagDetails,
    position,
    version,
    templateMetadata: {
      dateAdded,
      dateModified: dateModified ?? null,
      authorName: authorName ?? null,
      isExternal: isExternal ?? null,
      tags: templateTags(tagDetails),
    },
  };
}
