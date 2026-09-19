// The Annotations of one Attachment, read from one Annotation Source at a time.
import type { QueryFunction, QueryKey } from "@tanstack/query-core";

import {
  annotationTypeToName,
  getAnnotationsByParent,
  getAttachmentByKey,
  getLibraries,
  getZoteroDatabaseIdentity,
  parseAnnotationPosition,
  parseIndexedKey,
  resolveIndexedKeyLibrary,
} from "@zotlit/db";
import type {
  Annotation,
  AnnotationPosition,
  ResolvedAnnotationTypeName,
} from "@zotlit/db";
import type { NodeDatabaseClient } from "@zotlit/db/client/node";
import { createNanoEvents } from "@zotlit/shared/nanoevents";

import { getLogger } from "@/lib/log";
import type { DatabaseService } from "@/services/database/service";
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
import { resolvesSilently } from "./reconcile";
import {
  colorPatch,
  commentPatch,
  createRequest,
  eraseRequest,
  IDLE,
  MAX_POSITION_LENGTH,
  newWriteToken,
  writePosition,
} from "./write";
import type {
  AnnotationDraft,
  ConflictedWrite,
  MutationState,
  WriteFailure,
  WriteRequest,
  WriteTarget,
} from "./write";

export type { EditingCapability } from "./capability";
export type {
  AnnotationDraft,
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
   * The Annotation's Zotero tags, by name. Names rather than the numeric tag
   * ids SQLite keeps, because a name is what both sources can supply.
   */
  tags: readonly string[];
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
   * What a surface may do to an Attachment's Annotations moved. Every consumer
   * re-reads {@link AnnotationRepository.capabilityFor}; no record set is
   * affected, so nothing re-reads a list for this.
   */
  "capability-changed": () => void;
  /**
   * What a write left on one Annotation moved. A consumer re-reads
   * {@link AnnotationRepository.mutationFor} and redraws that card's verbs; no
   * record set is affected, because a write in flight draws nothing.
   *
   * @param annotationKey the Annotation's Indexed Key.
   */
  "mutation-changed": (annotationKey: string) => void;
  /** One shared comment draft moved. */
  "comment-draft-changed": (annotationKey: string) => void;
  /** A complete read confirmed that an Annotation no longer exists. */
  "annotation-deleted": (annotationKey: string, attachmentKey: string) => void;
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
    "invalidate" | "keysUnder" | "peek" | "read" | "update"
  >;
  localApi: Pick<
    ZoteroLocalApiClient,
    | "authorize"
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
}

/** One Annotation, beside the held list a write reads and replaces it in. */
interface HeldAnnotation {
  queryKey: QueryKey;
  /** The Attachment's Indexed Key, which the record itself names. */
  attachmentKey: string;
  record: AnnotationRecord;
}

type ConfirmedWrite =
  | { kind: "record"; record: AnnotationRecord; write: "color" | "comment" }
  | { kind: "created"; record: AnnotationRecord }
  | { kind: "deleted"; annotationKey: string };

interface CommentSave {
  idleTimer: ReturnType<typeof setTimeout> | null;
  burstTimer: ReturnType<typeof setTimeout> | null;
  inFlight: Promise<MutationState> | null;
  submittedText: string | null;
  queued: boolean;
}
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
 * the write before any request. Nothing is drawn ahead of Zotero, so the only
 * thing a write in flight changes on screen is that the verbs stand down.
 *
 * The Zotero DB partition is dropped wholesale whenever the database refreshes,
 * and the Zotero Local API partition whenever that source moves — a Freshness
 * Signal, another Zotero database, a capability that changed. Every Attachment
 * the drop concerns is announced through `annotations-changed`, which is the
 * only signal that a list was superseded.
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
   * What a write left on each Annotation it touched, by Indexed Key. An
   * Annotation no write is standing on has no entry, so the map holds only the
   * few a session has edited.
   */
  readonly #mutations = new Map<string, MutationState>();
  readonly #commentDrafts = new Map<string, CommentDraft>();
  readonly #commentDraftSources = new Map<string, string>();
  readonly #commentSaves = new Map<string, CommentSave>();
  readonly #commands = new Map<string, Promise<MutationState>>();
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

  ready: Promise<void>;

  constructor({
    db,
    queryClient,
    localApi,
    now = () => Temporal.Now.instant(),
    writeToken = newWriteToken,
  }: AnnotationRepositoryDeps) {
    super();
    this.#db = db;
    this.#queries = queryClient;
    this.#localApi = localApi;
    this.#now = now;
    this.#writeToken = writeToken;
    this.ready = this.#load();
  }

  /**
   * @param attachmentKey the Attachment's Indexed Key.
   * @returns the list that stands, or null while no read has answered for it.
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
      this.#publishedLists.set(attachmentKey, candidate);
      this.#publishedStatuses.set(
        attachmentKey,
        this.#queries.peek<AnnotationList>(queryKey)?.status ?? "fresh",
      );
      this.#reconcilePublishedDrafts(queryKey, attachmentKey, candidate);
      return candidate;
    }
    const published = this.#published(attachmentKey)?.value;
    if (
      candidate?.source.kind === "zotero-local-api" &&
      published?.source.kind === "zotero-local-api" &&
      candidate.source.serverID === published.source.serverID
    ) {
      this.#queries.update<AnnotationList>(queryKey, () => published);
    }
    return published ?? null;
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
   * What a write left on one Annotation, for the card that draws its verbs.
   *
   * @param annotationKey the Annotation's Indexed Key.
   */
  mutationFor(annotationKey: string): MutationState {
    return this.#mutations.get(annotationKey) ?? IDLE;
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
    const baseline = standing?.baseline ?? held!.record.comment ?? "";
    const draft = standing
      ? {
          ...standing,
          ...(text !== undefined && { text }),
          ...(text !== undefined &&
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
    this.#emitter.emit("comment-draft-changed", annotationKey);
    if (text !== undefined && draft.state.kind !== "conflict") {
      this.#scheduleCommentSave(draft);
    }
    return draft;
  }

  /** Submit the current shared draft once. */
  submitComment(annotationKey: string): Promise<MutationState> {
    const draft = this.commentDraftFor(annotationKey);
    if (!draft) return Promise.resolve(IDLE);
    const id = commentDraftID(draft.serverID, annotationKey);
    const save = this.#commentSave(id);
    this.#clearCommentTimers(save);
    if (draft.state.kind === "conflict") {
      return Promise.resolve(this.mutationFor(annotationKey));
    }
    if (save.inFlight) {
      save.queued = draft.text !== save.submittedText;
      return save.inFlight;
    }
    if (sameComment(draft.text, draft.baseline)) {
      this.#dropCommentDraft(annotationKey);
      return Promise.resolve(IDLE);
    }
    const submittedText = draft.text;
    this.#setCommentDraft(draft, { kind: "pending" });
    save.submittedText = submittedText;
    save.queued = false;
    const operation = this.#submitComment(annotationKey, draft, submittedText);
    save.inFlight = operation;
    void operation.then((outcome) => {
      save.inFlight = null;
      save.submittedText = null;
      if (
        outcome.kind === "idle" &&
        save.queued &&
        this.#commentDrafts.has(id)
      ) {
        void this.submitComment(annotationKey);
      }
    });
    return operation;
  }

  async #submitComment(
    annotationKey: string,
    submitted: CommentDraft,
    submittedText: string,
  ): Promise<MutationState> {
    const id = commentDraftID(submitted.serverID, annotationKey);
    const outcome = await this.#patchComment(
      annotationKey,
      submittedText,
      false,
    );
    const current = this.#commentDrafts.get(id);
    if (!current || current.state.kind === "conflict") return outcome;
    if (outcome.kind === "idle") {
      if (sameComment(current.text, submittedText)) {
        this.#dropCommentDraft(annotationKey, submitted.serverID);
      } else {
        this.#commentDrafts.set(id, {
          ...current,
          baseline: submittedText,
          state: { kind: "editing" },
        });
        this.#emitter.emit("comment-draft-changed", annotationKey);
      }
    } else if (outcome.kind === "conflict") {
      const fresh = outcome.conflict.fresh ?? "";
      this.#commentDrafts.set(id, {
        ...current,
        state: { kind: "conflict", fresh },
      });
      this.#emitter.emit("comment-draft-changed", annotationKey);
    } else if (outcome.kind === "failed") {
      this.#setCommentDraft(current, {
        kind: "failed",
        failure: outcome.failure,
      });
    }
    return outcome;
  }

  /** Keep Zotero's reviewed comment and discard the local draft. */
  discardCommentDraft(annotationKey: string): void {
    this.#dropCommentDraft(annotationKey);
    const mutation = this.#mutations.get(annotationKey);
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
    const id = commentDraftID(draft.serverID, annotationKey);
    const save = this.#commentSave(id);
    this.#clearCommentTimers(save);
    if (save.inFlight) return save.inFlight;
    save.submittedText = draft.text;
    save.queued = false;
    const operation = this.#retryCommentDraft(annotationKey, draft);
    save.inFlight = operation;
    void operation.then((outcome) => {
      save.inFlight = null;
      save.submittedText = null;
      if (
        outcome.kind === "idle" &&
        save.queued &&
        this.#commentDrafts.has(id)
      ) {
        void this.submitComment(annotationKey);
      }
    });
    return operation;
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
      sameComment(outcome.conflict.fresh, reviewed)
    ) {
      outcome = await this.patchComment(annotationKey, submittedText);
    }
    const current = this.#commentDrafts.get(id);
    if (!current) return outcome;
    if (outcome.kind === "idle") {
      if (sameComment(current.text, submittedText)) {
        this.#dropCommentDraft(annotationKey, draft.serverID);
      } else {
        this.#commentDrafts.set(id, {
          ...current,
          baseline: submittedText,
          state: { kind: "editing" },
        });
        this.#emitter.emit("comment-draft-changed", annotationKey);
      }
    } else if (outcome.kind === "conflict") {
      this.#commentDrafts.set(id, {
        ...current,
        state: {
          kind: "conflict",
          fresh: outcome.conflict.fresh ?? "",
        },
      });
      this.#emitter.emit("comment-draft-changed", annotationKey);
    } else if (outcome.kind === "failed") {
      this.#setCommentDraft(current, {
        kind: "failed",
        failure: outcome.failure,
      });
    }
    return outcome;
  }

  /**
   * Create one highlight or underline on an Attachment, from a user gesture.
   *
   * The gesture is what may open Zotero's dialog, so a session that has not
   * been authorized asks here and continues on Allow; nothing else in this
   * class does. The write itself is a one-element multi-object `POST` carrying
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
   * @see apps/obsidian/docs/adr/0038-write-authorization-starts-only-from-a-user-gesture.md
   */
  async createAnnotation(
    attachmentKey: string,
    draft: Omit<AnnotationDraft, "parentKey">,
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

    const blocked = await this.#authorizeGesture(attachmentKey);
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
    return await this.#patchComment(annotationKey, comment, true);
  }

  async #patchComment(
    annotationKey: string,
    comment: string,
    authorize: boolean,
  ): Promise<MutationState> {
    return await this.#command(annotationKey, {
      write: "comment",
      attempted: comment,
      request: (target) => commentPatch(target, comment),
      authorize,
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
    this.#cancelCommentSave(annotationKey);
    return await this.#command(annotationKey, {
      write: "delete",
      attempted: null,
      request: eraseRequest,
      settle: "drop",
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
    const standing = this.#mutations.get(annotationKey);
    if (standing?.kind !== "conflict") return standing ?? IDLE;
    const { write, attempted } = standing.conflict;
    switch (write) {
      case "color":
        return await this.patchColor(annotationKey, attempted ?? "");
      case "comment":
        return await this.patchComment(annotationKey, attempted ?? "");
      case "delete":
        return await this.deleteAnnotation(annotationKey);
    }
  }

  /**
   * Leave Zotero's copy as it stands, from the card's "Discard". The card goes
   * back to what the last read answered; nothing is sent.
   *
   * @param annotationKey the Annotation's Indexed Key.
   */
  discardConflict(annotationKey: string): void {
    if (this.#mutations.get(annotationKey)?.kind !== "conflict") return;
    logger.debug("A write conflict was discarded", { annotationKey });
    this.#settle(annotationKey, IDLE);
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
      this.#localApi.demandSource() && !this.#compatibleApiSource(attachmentKey)
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
   * The gesture behind the command is what may open Zotero's dialog, exactly as
   * it is for a create: under `authorization-required` the write waits on the
   * same one-request-at-a-time continuation and goes on after Allow, rather
   * than being sent keyless and coming back `401`.
   *
   * @param command.write which verb this is, so a conflict can name the two
   *   values the card puts side by side.
   * @param command.attempted the value the user asked for; `null` for a delete.
   * @param command.settle whether the Annotation is read back after the `204`,
   *   or leaves the list because the write erased it.
   * @see apps/obsidian/docs/adr/0034-the-annotation-source-is-atomic-per-attachment.md
   * @see apps/obsidian/docs/adr/0038-write-authorization-starts-only-from-a-user-gesture.md
   */
  async #command(
    annotationKey: string,
    command: {
      write: ConflictedWrite;
      attempted: string | null;
      request: (target: WriteTarget) => WriteRequest;
      settle?: "re-read" | "drop";
      authorize?: boolean;
    },
  ): Promise<MutationState> {
    const expectedServerID = this.#localApi.demandSource()?.serverID ?? null;
    const generation = this.#commandGeneration;
    const previous = this.#commands.get(annotationKey);
    const queued = { expectedServerID, generation, ...command };
    const operation = previous
      ? previous.then(() => this.#runCommand(annotationKey, queued))
      : this.#runCommand(annotationKey, queued);
    this.#commands.set(annotationKey, operation);
    void operation.finally(() => {
      if (this.#commands.get(annotationKey) === operation) {
        this.#commands.delete(annotationKey);
      }
    });
    return await operation;
  }

  async #runCommand(
    annotationKey: string,
    command: {
      expectedServerID: string | null;
      generation: number;
      write: ConflictedWrite;
      attempted: string | null;
      request: (target: WriteTarget) => WriteRequest;
      settle?: "re-read" | "drop";
      authorize?: boolean;
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
      return this.#settle(annotationKey, {
        kind: "failed",
        failure: { kind: "unknown-annotation" },
      });
    }
    if (!this.#compatibleApiSource(held.attachmentKey)) {
      return this.#settle(annotationKey, {
        kind: "failed",
        failure: { kind: "db-source" },
      });
    }
    const { version } = held.record;
    if (version === null) {
      return this.#settle(annotationKey, {
        kind: "failed",
        failure: { kind: "db-source" },
      });
    }

    this.#settle(annotationKey, { kind: "pending" });
    const blocked =
      command.authorize === false
        ? this.#backgroundWriteBlocked(held.attachmentKey)
        : await this.#authorizeGesture(held.attachmentKey);
    if (blocked) {
      return this.#settle(annotationKey, {
        kind: "failed",
        failure: blocked,
      });
    }

    const library = libraryPath(parsed);
    const { path, method, headers, body } = command.request({
      library,
      key: parsed.key,
      version,
    });
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
      return this.#settle(annotationKey, {
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
      const state = await this.#writeRefused(held, annotationKey, {
        write: command.write,
        attempted: command.attempted,
        failure: reply.failure,
      });
      if (state.kind === "failed") await this.refresh(held.attachmentKey);
      this.#settle(annotationKey, state);
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
      return this.#settle(annotationKey, {
        kind: "failed",
        failure: applied.failure,
      });
    }
    if (command.settle === "drop") this.#dropCommentDraft(annotationKey);
    this.#publishQuery(held.attachmentKey, held.queryKey);
    if (applied.value.kind === "deleted") {
      this.#reconcilePublishedDrafts(
        held.queryKey,
        held.attachmentKey,
        this.#publishedLists.get(held.attachmentKey) ?? null,
      );
    }
    await this.#refreshConfirmed(held.attachmentKey, applied.value);
    this.#emitter.emit("annotations-changed", held.attachmentKey);
    return this.#settle(annotationKey, IDLE);
  }

  #backgroundWriteBlocked(attachmentKey: string): WriteFailure | null {
    return this.#capability(attachmentKey).kind === "authorization-required"
      ? { kind: "unauthorized" }
      : null;
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
   * @see https://github.com/aidenlx/zotlit/issues/1139 — "Editing Capability and degraded states"
   */
  async #writeRefused(
    held: HeldAnnotation,
    annotationKey: string,
    refusal: {
      write: ConflictedWrite;
      attempted: string | null;
      failure: WriteFailure;
    },
  ): Promise<MutationState> {
    const { write, attempted, failure } = refusal;
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

    const value = freshValueOf(record, write);
    if (resolvesSilently(write, attempted, value)) {
      logger.debug("A write conflict resolved to the value Zotero holds", {
        annotationKey,
        write,
      });
      return IDLE;
    }
    return { kind: "conflict", conflict: { write, attempted, fresh: value } };
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
    { write, settle }: { write: ConflictedWrite; settle: "re-read" | "drop" },
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
        write: write === "comment" ? "comment" : "color",
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
   * Zotero's own dialog, where this Attachment needs one before it can be
   * written to. A session that already holds an authorization asks nothing.
   *
   * @returns why the gesture cannot go on, or `null` where it can.
   * @see apps/obsidian/docs/adr/0038-write-authorization-starts-only-from-a-user-gesture.md
   */
  async #authorizeGesture(attachmentKey: string): Promise<WriteFailure | null> {
    if (this.#capability(attachmentKey).kind !== "authorization-required") {
      return null;
    }
    const granted = await this.#localApi.authorize();
    return "failure" in granted ? granted.failure : null;
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

  /** Records one Annotation's mutation state and announces it. */
  #settle(annotationKey: string, state: MutationState): MutationState {
    if (state.kind === "idle") this.#mutations.delete(annotationKey);
    else this.#mutations.set(annotationKey, state);
    this.#emitter.emit("mutation-changed", annotationKey);
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
    this.#emitter.emit("comment-draft-changed", draft.annotationKey);
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
    this.#emitter.emit("comment-draft-changed", annotationKey);
  }

  #commentSave(id: string): CommentSave {
    const standing = this.#commentSaves.get(id);
    if (standing) return standing;
    const save: CommentSave = {
      idleTimer: null,
      burstTimer: null,
      inFlight: null,
      submittedText: null,
      queued: false,
    };
    this.#commentSaves.set(id, save);
    return save;
  }

  #scheduleCommentSave(draft: CommentDraft): void {
    const id = commentDraftID(draft.serverID, draft.annotationKey);
    const save = this.#commentSave(id);
    if (save.inFlight) {
      save.queued = draft.text !== save.submittedText;
      return;
    }
    if (sameComment(draft.text, draft.baseline)) return;
    if (save.idleTimer !== null) clearTimeout(save.idleTimer);
    save.idleTimer = setTimeout(() => {
      save.idleTimer = null;
      void this.submitComment(draft.annotationKey);
    }, COMMENT_IDLE_SAVE_MS);
    save.burstTimer ??= setTimeout(() => {
      save.burstTimer = null;
      void this.submitComment(draft.annotationKey);
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
    save.queued = false;
    if (!save.inFlight) this.#commentSaves.delete(id);
  }

  #cancelAllCommentSaves(): void {
    for (const save of this.#commentSaves.values()) {
      this.#clearCommentTimers(save);
      save.queued = false;
    }
  }

  /** Reconcile drafts only against a complete read from their own database. */
  #reconcileCommentDrafts(
    source: LocalApiSource,
    attachmentKey: string,
    annotations: readonly AnnotationRecord[],
  ): void {
    const records = new Map(annotations.map((record) => [record.key, record]));
    for (const draft of this.#commentDrafts.values()) {
      if (
        draft.serverID !== source.serverID ||
        draft.attachmentKey !== attachmentKey
      ) {
        continue;
      }
      const record = records.get(draft.annotationKey);
      if (!record) {
        this.#dropCommentDraft(draft.annotationKey, source.serverID);
        this.#settle(draft.annotationKey, IDLE);
        this.#emitter.emit(
          "annotation-deleted",
          draft.annotationKey,
          attachmentKey,
        );
        continue;
      }
      const fresh = record.comment ?? "";
      const save = this.#commentSaves.get(
        commentDraftID(source.serverID, draft.annotationKey),
      );
      if (draft.state.kind === "pending") {
        if (
          save &&
          save.submittedText !== null &&
          sameComment(fresh, save.submittedText)
        ) {
          this.#commentDrafts.set(
            commentDraftID(source.serverID, draft.annotationKey),
            { ...draft, baseline: fresh },
          );
          this.#emitter.emit("comment-draft-changed", draft.annotationKey);
        }
        continue;
      }
      if (sameComment(fresh, draft.text)) {
        this.#dropCommentDraft(draft.annotationKey, source.serverID);
        continue;
      }
      if (sameComment(fresh, draft.baseline)) continue;
      if (sameComment(draft.text, draft.baseline)) {
        this.#commentDrafts.set(
          commentDraftID(source.serverID, draft.annotationKey),
          {
            ...draft,
            baseline: fresh,
            text: fresh,
            state: { kind: "editing" },
          },
        );
        this.#emitter.emit("comment-draft-changed", draft.annotationKey);
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
      this.#emitter.emit("comment-draft-changed", draft.annotationKey);
      this.#emitter.emit("write-conflict", draft.annotationKey, attachmentKey);
    }
  }

  /** Reconcile only the Local API result Query Core accepted for publication. */
  #reconcilePublishedDrafts(
    queryKey: QueryKey,
    attachmentKey: string,
    list: AnnotationList | null,
  ): void {
    if (list?.source.kind !== "zotero-local-api") return;
    const held = this.#queries.peek<AnnotationList>(queryKey);
    if (held?.status !== "fresh" || held.value !== list) return;
    this.#reconcileCommentDrafts(list.source, attachmentKey, list.annotations);
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
          this.#emitter.emit("comment-draft-changed", draft.annotationKey);
        }
      }
      for (const { key } of this.#publishedLists.get(attachmentKey)
        ?.annotations ?? []) {
        if (this.#mutations.delete(key)) {
          this.#emitter.emit("mutation-changed", key);
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
  }

  #published(attachmentKey: string): Held<AnnotationList> | null {
    const value = this.#publishedLists.get(attachmentKey);
    return value
      ? {
          value,
          status: this.#publishedStatuses.get(attachmentKey) ?? "fresh",
          settled: Promise.resolve(value),
        }
      : null;
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

/** What Zotero holds now for the field one refused write asked to change. */
function freshValueOf(
  record: AnnotationRecord,
  write: ConflictedWrite,
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
  }
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
    tags: annotation.tags,
    position: parseAnnotationPosition(annotation.position, contentType),
    version: annotation.version,
  };
}

/** The Sort Index stays with the client: it ordered the list and nothing else reads it. */
function fromLocalApi({
  key,
  type,
  color,
  comment,
  text,
  parentKey,
  pageLabel,
  tags,
  position,
  version,
}: LocalApiAnnotation): AnnotationRecord {
  return {
    key,
    type,
    color,
    comment,
    text,
    parentKey,
    pageLabel,
    tags,
    position,
    version,
  };
}
