// The Annotations of one Attachment, read from one Annotation Source at a time.
import type { QueryKey } from "@tanstack/query-core";

import {
  annotationTypeToName,
  getAnnotationsByParent,
  getAttachmentByKey,
  parseAnnotationPosition,
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

const logger = getLogger("annotation-repository");

/** The namespace this repository owns on the plugin-wide query client. */
const ANNOTATIONS = "annotations";

/** The partition the Zotero database answers from, keyed by Indexed Key. */
const ZOTERO_DB = "zotero-db";

/**
 * Where a whole record set came from. The source is atomic per Attachment: a
 * list is wholly one source's, and the two sets never join.
 *
 * The Zotero Local API source, which also carries its Zotero Server ID, lands
 * with the client that reads it (aidenlx/zotlit#1143).
 *
 * @see apps/obsidian/docs/adr/0034-the-annotation-source-is-atomic-per-attachment.md
 */
export type AnnotationSource = { kind: "zotero-db" };

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
  /** Parsed once per read, so a redraw parses nothing. */
  position: AnnotationPosition;
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
}

export interface AnnotationRepositoryDeps {
  db: Pick<DatabaseService, "acquireRead" | "on">;
  queryClient: Pick<
    QueryClientService,
    "invalidate" | "keysUnder" | "peek" | "read"
  >;
}

/** One partition's key and the read that fills it. */
interface AnnotationPartition {
  queryKey: QueryKey;
  read: () => Promise<AnnotationList>;
}

/**
 * Answers an Attachment's Annotations from the Annotation Source that is active
 * for it, and says which source answered. Reads are held on the plugin-wide
 * query client, so the overlay and the Annotation View asking for one Attachment
 * at once cost one database read.
 *
 * The Zotero DB partition is dropped wholesale whenever the database refreshes,
 * and every Attachment it held is announced through `annotations-changed`.
 *
 * @see apps/obsidian/docs/adr/0034-the-annotation-source-is-atomic-per-attachment.md
 * @see docs/adr/0060-held-reads-are-realized-on-tanstack-query-core.md
 */
export class AnnotationRepository extends Service<void> {
  readonly #db;
  readonly #queries;
  readonly #emitter = createNanoEvents<AnnotationRepositoryEvents>();

  ready: Promise<void>;

  constructor({ db, queryClient }: AnnotationRepositoryDeps) {
    super();
    this.#db = db;
    this.#queries = queryClient;
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

  on<K extends keyof AnnotationRepositoryEvents>(
    event: K,
    cb: AnnotationRepositoryEvents[K],
  ): () => void {
    return this.#emitter.on(event, cb);
  }

  async #load(): Promise<void> {
    await using stack = new AsyncDisposableStack();
    stack.defer(this.#db.on("changed", () => this.#dropDatabasePartition()));
    this.commit(stack.move());
  }

  /**
   * The partition the active Annotation Source answers from.
   *
   * The Zotero DB is the only source this milestone reads. The Zotero Local API
   * partition adds its branch here — its own key prefix carrying the Zotero
   * Server ID beside the Indexed Key, and its own read — and nothing outside
   * this method moves: {@link read} and {@link peek} never name a source, and a
   * result already carries the one that answered it.
   */
  #activePartition(attachmentKey: string): AnnotationPartition {
    return {
      queryKey: [ANNOTATIONS, ZOTERO_DB, attachmentKey],
      read: () => this.#readFromDatabase(attachmentKey),
    };
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
   * A refreshed database replaces every row the partition held, so the whole
   * partition goes rather than the rows a comparison would call changed.
   */
  #dropDatabasePartition(): void {
    const prefix = [ANNOTATIONS, ZOTERO_DB];
    const held = this.#queries
      .keysUnder(prefix)
      .map((queryKey) => queryKey[prefix.length])
      .filter((key) => typeof key === "string");
    this.#queries.invalidate(prefix);
    logger.debug("Zotero database annotation partition dropped", {
      attachments: held.length,
    });
    for (const attachmentKey of held) {
      this.#emitter.emit("annotations-changed", attachmentKey);
    }
  }
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
    toRecord(annotation, contentType),
  );
}

function toRecord(
  annotation: Annotation,
  contentType: string,
): AnnotationRecord {
  return {
    key: annotation.indexedKey,
    type: annotationTypeToName(annotation.type),
    color: annotation.color,
    comment: annotation.comment,
    text: annotation.text,
    position: parseAnnotationPosition(annotation.position, contentType),
  };
}
