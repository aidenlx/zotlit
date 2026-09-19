// The Annotations of one Attachment, read from one Annotation Source at a time.
import type { QueryFunction, QueryKey } from "@tanstack/query-core";

import {
  annotationTypeToName,
  formatIndexedKey,
  getAnnotationsByParent,
  getAttachmentByKey,
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
import { matchCreatedAnnotation, resolvesSilently } from "./reconcile";
import type { CreateMatch } from "./reconcile";
import {
  colorPatch,
  commentPatch,
  createRequest,
  eraseRequest,
  IDLE,
  MAX_POSITION_LENGTH,
  newWriteToken,
  UNCERTAIN,
  writePosition,
} from "./write";
import type {
  AnnotationDraft,
  ConflictedWrite,
  CreateRequest,
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

/**
 * Where a whole record set came from. The source is atomic per Attachment: a
 * list is wholly one source's, and the two sets never join.
 *
 * @see apps/obsidian/docs/adr/0034-the-annotation-source-is-atomic-per-attachment.md
 */
export type AnnotationSource = { kind: "zotero-db" } | LocalApiSource;

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
  /**
   * The Uncertain Creates standing on some Attachment moved: one appeared, was
   * confirmed, was retried, or was discarded. A consumer re-reads
   * {@link AnnotationRepository.uncertainCreatesFor}.
   */
  "uncertain-creates-changed": () => void;
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

/**
 * One create whose outcome is not yet known, kept with the write token that
 * made it and the instant it left. An answer that never arrives leaves this
 * entry standing, which is what an Uncertain Create is reconciled from: the
 * `dateAdded` window starts at {@link PendingCreate.startedAt}, and "Try again"
 * re-sends {@link PendingCreate.request} on the same token.
 *
 * @see apps/obsidian/docs/adr/0039-an-uncertain-create-is-reconciled-by-stable-fields-and-retried-only-by-the-user.md
 * @see https://github.com/aidenlx/zotlit/issues/1151
 */
export interface PendingCreate {
  /** The Attachment's Indexed Key. */
  attachmentKey: string;
  /** What the create asked Zotero for, as the stable fields to match on. */
  draft: AnnotationDraft;
  /** The request as sent, so a retry is the same request on the same token. */
  request: CreateRequest;
  startedAt: Temporal.Instant;
  /**
   * Whether an answer has already been lost. Only then is there a card: a
   * create still waiting for its first answer shows as disabled verbs on the
   * surface that started it, and nothing is drawn ahead of Zotero.
   */
  uncertain: boolean;
  /**
   * What this create leaves on its badged card: `uncertain` while it stands,
   * `pending` while the user's retry is in flight, `failed` where that retry
   * was refused.
   */
  state: MutationState;
}

/** One Uncertain Create as a surface reads it, beside the token that names it. */
export interface UncertainCreate {
  /** Zotero remembers this for twelve hours, so a retry cannot create twice. */
  writeToken: string;
  /** The Attachment's Indexed Key. */
  attachmentKey: string;
  /** What the create asked Zotero for, which is what the badged card shows. */
  draft: AnnotationDraft;
  state: MutationState;
}

/** What one create ended with. */
export type CreateOutcome =
  /** @param annotationKey the Indexed Key Zotero generated. */
  | { kind: "created"; annotationKey: string }
  /**
   * The answer never arrived, so the Annotation may or may not exist. The
   * create stays in {@link AnnotationRepository.pendingCreates} until a
   * reconciliation settles it.
   */
  | { kind: "uncertain" }
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
  /**
   * Every create whose outcome is not yet known, by write token. An entry
   * leaves as soon as Zotero says what happened; one whose answer never
   * arrived stays, and is what aidenlx/zotlit#1151 reconciles.
   */
  readonly #creates = new Map<string, PendingCreate>();
  /** One explicit revalidation per visible Attachment. */
  readonly #refreshes = new Map<string, Promise<AnnotationList | null>>();
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
    return await this.#queries.read(queryKey, read);
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
    if (this.#localApi.demandSource() === null) await this.#db.refresh();
    const { queryKey, read } = this.#activePartition(attachmentKey);
    this.#queries.invalidate(queryKey);
    this.#emitter.emit("annotations-changed", attachmentKey);
    return await this.#queries.read(queryKey, read);
  }

  /**
   * What `attachmentKey` holds right now, for a caller that cannot wait — a
   * surface redrawing synchronously. The Held Read travels whole, so the caller
   * can tell a list that stands from one a refresh has already superseded.
   *
   * @returns null while no read has answered for the Attachment.
   */
  peek(attachmentKey: string): Held<AnnotationList> | null {
    const { queryKey } = this.#activePartition(attachmentKey);
    return this.#queries.peek<AnnotationList>(queryKey);
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

  /**
   * Every create whose outcome is still unknown, by write token. Empty in a
   * session where every create was answered.
   */
  get pendingCreates(): ReadonlyMap<string, PendingCreate> {
    return this.#creates;
  }

  /**
   * The Uncertain Creates one Attachment carries, in the order they were made
   * — the badged cards the Annotation View shows under its list. A create
   * still waiting for its first answer is not one of them: nothing is drawn
   * ahead of Zotero.
   *
   * They live in memory alone, so they are gone after a reload; a switch to
   * the Zotero DB source and a Zotero database change drop them too, because
   * neither can answer for the create that made them.
   *
   * @param attachmentKey the Attachment's Indexed Key.
   * @see apps/obsidian/docs/adr/0039-an-uncertain-create-is-reconciled-by-stable-fields-and-retried-only-by-the-user.md
   */
  uncertainCreatesFor(attachmentKey: string): readonly UncertainCreate[] {
    const standing: UncertainCreate[] = [];
    for (const [writeToken, pending] of this.#creates) {
      if (!pending.uncertain || pending.attachmentKey !== attachmentKey) {
        continue;
      }
      standing.push({
        writeToken,
        attachmentKey: pending.attachmentKey,
        draft: pending.draft,
        state: pending.state,
      });
    }
    return standing;
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
    if (!this.#localApi.demandSource()) {
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
    const pending: PendingCreate = {
      attachmentKey,
      draft: whole,
      request,
      startedAt: this.#now(),
      uncertain: false,
      state: { kind: "pending" },
    };
    this.#creates.set(request.writeToken, pending);
    return await this.#sendCreate(request.writeToken, pending);
  }

  /**
   * Send one Uncertain Create again, from the user's "Try again" and from
   * nothing else. The request and its `Zotero-Write-Token` are the original
   * ones, so a first write that did land answers `412 Write token already
   * used` rather than creating a second Annotation.
   *
   * A One-time Authorization is spent by the request that lost its answer, so
   * this asks Zotero's dialog again where the session no longer holds a key —
   * the retry is a user gesture like the create was.
   *
   * @param writeToken the token {@link AnnotationRepository.uncertainCreatesFor} named.
   * @see apps/obsidian/docs/adr/0039-an-uncertain-create-is-reconciled-by-stable-fields-and-retried-only-by-the-user.md
   */
  async retryCreate(writeToken: string): Promise<CreateOutcome> {
    const pending = this.#creates.get(writeToken);
    if (!pending) {
      return { kind: "failed", failure: { kind: "unknown-annotation" } };
    }
    this.#createSettled(writeToken, pending, { kind: "pending" });
    return await this.#sendCreate(writeToken, pending);
  }

  /**
   * Drop one Uncertain Create, from the user's "Discard". Zotero is not asked
   * anything: the Annotation either landed, and the next read shows it, or it
   * never did.
   *
   * @param writeToken the token {@link AnnotationRepository.uncertainCreatesFor} named.
   */
  discardCreate(writeToken: string): void {
    if (!this.#creates.delete(writeToken)) return;
    logger.debug("An uncertain create was discarded", { writeToken });
    this.#emitter.emit("uncertain-creates-changed");
  }

  /**
   * One create request, and everything its answer settles — shared by the
   * first send and by the user's retry, because the two differ only in what
   * came before them.
   */
  async #sendCreate(
    writeToken: string,
    pending: PendingCreate,
  ): Promise<CreateOutcome> {
    const { attachmentKey, draft, request } = pending;
    const parsed = parseIndexedKey(attachmentKey);
    if (!parsed) {
      return { kind: "failed", failure: { kind: "unknown-annotation" } };
    }
    const library = libraryPath(parsed);
    const reply = await this.#localApi.authorizedSend(request.path, {
      library,
      method: request.method,
      headers: request.headers,
      body: request.body,
    });
    if ("failure" in reply) {
      return await this.#createRefused(writeToken, pending, reply.failure);
    }

    const created = readCreateResult(reply.value.text, {
      parentKey: parsed.key,
      type: draft.type,
    });
    if ("failure" in created) {
      return this.#createFailed(writeToken, pending, created.failure);
    }

    const annotationKey = formatIndexedKey(created.value, parsed.groupID);
    logger.debug("Zotero created an annotation", {
      attachmentKey,
      annotationKey,
      type: draft.type,
    });
    return await this.#createLanded(writeToken, pending, annotationKey);
  }

  /**
   * What a refused create leaves behind.
   *
   * A lost answer is the one refusal that leaves the create standing: the
   * Annotation may exist, so ZotLit re-reads the Attachment and matches the
   * intended create on its stable fields. A `412 Write token already used`
   * says the first write did land, so the same match names what it created.
   * Every other refusal is an answer: the create did not land.
   */
  async #createRefused(
    writeToken: string,
    pending: PendingCreate,
    failure: WriteFailure,
  ): Promise<CreateOutcome> {
    const { attachmentKey } = pending;
    if (
      failure.kind !== "unknown-outcome" &&
      failure.kind !== "write-token-used"
    ) {
      return this.#createFailed(writeToken, pending, failure);
    }
    logger.debug(
      failure.kind === "unknown-outcome"
        ? "A create lost its answer"
        : "A retried create met its own write token",
      { attachmentKey },
    );

    const match = await this.#matchCreate(pending);
    if (match?.kind === "confirmed") {
      return await this.#createLanded(writeToken, pending, match.annotationKey);
    }
    // A write token Zotero has already spent says the Annotation exists even
    // where the match cannot name it, so the list is dropped either way and
    // the next read shows whatever Zotero holds.
    if (failure.kind === "write-token-used")
      this.#dropAttachment(attachmentKey);
    this.#createSettled(writeToken, { ...pending, uncertain: true }, UNCERTAIN);
    return { kind: "uncertain" };
  }

  /**
   * The Annotation one create asked for, if exactly one of the Attachment's
   * Annotations carries every stable field and was added while the request ran.
   *
   * @returns the match, or `null` where Zotero could not be re-read at all —
   *   which says nothing about the create and so leaves it uncertain.
   */
  async #matchCreate(pending: PendingCreate): Promise<CreateMatch | null> {
    const { attachmentKey, draft, startedAt } = pending;
    const listed = await this.#localApi.listAnnotations(attachmentKey);
    if ("failure" in listed) {
      logger.debug("An uncertain create could not be reconciled", {
        attachmentKey,
        failure: listed.failure,
      });
      return null;
    }
    const match = matchCreatedAnnotation(draft, attachmentKey, {
      candidates: listed.value,
      window: { from: startedAt, to: this.#now() },
    });
    logger.debug("An uncertain create was matched against Zotero", {
      attachmentKey,
      match,
    });
    return match;
  }

  /** One create that is known to have landed: the entry goes and the list drops. */
  async #createLanded(
    writeToken: string,
    pending: PendingCreate,
    annotationKey: string,
  ): Promise<CreateOutcome> {
    this.#creates.delete(writeToken);
    await this.refresh(pending.attachmentKey);
    if (pending.uncertain) this.#emitter.emit("uncertain-creates-changed");
    return { kind: "created", annotationKey };
  }

  /**
   * One create Zotero refused outright. A first send that is refused never
   * landed, so its entry goes; a retry that is refused says nothing about the
   * original create, so the badged card stands and carries the refusal.
   */
  #createFailed(
    writeToken: string,
    pending: PendingCreate,
    failure: WriteFailure,
  ): CreateOutcome {
    if (pending.uncertain) {
      this.#createSettled(writeToken, pending, { kind: "failed", failure });
    } else {
      this.#creates.delete(writeToken);
    }
    return { kind: "failed", failure };
  }

  /** Records what one create left on its badged card and announces it. */
  #createSettled(
    writeToken: string,
    pending: PendingCreate,
    state: MutationState,
  ): void {
    this.#creates.set(writeToken, { ...pending, state });
    this.#emitter.emit("uncertain-creates-changed");
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
    return await this.#command(annotationKey, {
      write: "comment",
      attempted: comment,
      request: (target) => commentPatch(target, comment),
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
    // A create belongs to the database that was asked to make it, so another
    // one answering the port takes every Uncertain Create with it.
    stack.defer(
      this.#localApi.on("server-changed", () => {
        this.#dropUncertainCreates("the Zotero database changed");
      }),
    );
    this.commit(stack.move());
  }

  /**
   * Every Uncertain Create goes: the source that could reconcile them is no
   * longer the one that was asked to make them, and a retry against another
   * database or against the Zotero DB source means nothing.
   */
  #dropUncertainCreates(reason: string): void {
    if (this.#creates.size === 0) return;
    logger.debug("Uncertain creates dropped", {
      reason,
      creates: this.#creates.size,
    });
    this.#creates.clear();
    this.#emitter.emit("uncertain-creates-changed");
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
    const capability = editingCapabilityOf(
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
   * answered, which is what makes a command take keys alone. A record with no
   * version came from the Zotero DB partition, which keeps none, so the write
   * is refused there and then — before any request, because there is no
   * precondition to send and an unconditional write would overwrite whatever
   * Zotero holds.
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
    },
  ): Promise<MutationState> {
    const held = this.#holding(annotationKey);
    const parsed = parseIndexedKey(annotationKey);
    if (!held || !parsed) {
      return this.#settle(annotationKey, {
        kind: "failed",
        failure: { kind: "unknown-annotation" },
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
    const blocked = await this.#authorizeGesture(held.attachmentKey);
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
    const reply = await this.#localApi.authorizedSend(path, {
      library,
      method,
      headers,
      body,
    });
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
      this.#settle(annotationKey, state);
      if (state.kind === "conflict") {
        this.#emitter.emit("write-conflict", annotationKey, held.attachmentKey);
      }
      return state;
    }

    logger.debug("Zotero took a write", { annotationKey, method });
    await this.refresh(held.attachmentKey);
    await this.#applyWrite(held, annotationKey, command.settle ?? "re-read");
    this.#emitter.emit("annotations-changed", held.attachmentKey);
    return this.#settle(annotationKey, IDLE);
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
    settle: "re-read" | "drop",
  ): Promise<void> {
    const { queryKey, attachmentKey } = held;
    if (settle === "drop") {
      this.#queries.update<AnnotationList>(queryKey, (list) => ({
        ...list,
        annotations: list.annotations.filter(
          (record) => record.key !== annotationKey,
        ),
      }));
      return;
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
      return;
    }
    const record = fromLocalApi(fresh.value);
    this.#queries.update<AnnotationList>(queryKey, (list) => ({
      ...list,
      annotations: list.annotations.map((stale) =>
        stale.key === annotationKey ? record : stale,
      ),
    }));
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
      const record = list?.annotations.find(
        (annotation) => annotation.key === annotationKey,
      );
      if (record) {
        return { queryKey, attachmentKey: record.parentKey, record };
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
    const source = this.#localApi.demandSource();
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
      queryKey: [ANNOTATIONS, ZOTERO_DB, attachmentKey],
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
    logger.debug("Annotations read from the Zotero database", {
      attachmentKey,
      annotations: annotations.length,
    });
    return { source: { kind: "zotero-db" }, annotations };
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
    if (source === null) {
      this.#dropUncertainCreates("the Zotero DB source answers now");
    }
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
    // The Zotero DB keeps no object version, which is why the Zotero DB source
    // refuses a write rather than sending a precondition it cannot supply.
    version: null,
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
