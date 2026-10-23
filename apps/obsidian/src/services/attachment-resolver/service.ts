import type { AttachmentWithParentKey } from "@zotlit/db";
import { attachmentAbsPath, attachmentPathKey } from "@zotlit/db/path";
import type { AttachmentPathContext } from "@zotlit/db/path";
import { createNanoEvents } from "@zotlit/shared/nanoevents";

// Names the Zotero Attachment behind the absolute path of an open PDF.
import { Effect, Stream } from "@/lib/effect";
import { getLogger } from "@/lib/log";
import { isPdfAttachment } from "@/services/attachment-open/resolve";
import type { PlainQueryClients } from "@/services/query-client/plain";
import { Service } from "@/services/service-base";
import type { ZoteroPrefService } from "@/services/zotero-pref/service";
import type { ZoteroReadsService } from "@/services/zotero-reads/service";

const logger = getLogger("attachment-resolver");

/**
 * What an open PDF resolves to in the Zotero library. Both keys are Indexed
 * Keys — `key` for the personal library, `key + "g" + groupID` for a group — as
 * ADR 0033 settles and `formatIndexedKey` in `@zotlit/db` formats.
 *
 * `pending` and `unresolved` are different answers: the first says the resolver
 * cannot answer yet, the second says Zotero does not know this file. A caller
 * holding a `pending` resolution asks again on `resolutions-changed`.
 *
 * @see apps/obsidian/docs/adr/0033-zotero-object-identity-is-the-indexed-key-server-id-is-source-data.md
 */
export type AttachmentResolution =
  | {
      kind: "resolved";
      attachmentKey: string;
      /** Identity of the database that resolved this file. */
      serverID: string | null;
      /** The parent Item's Indexed Key; `null` for a standalone Attachment. */
      itemKey: string | null;
      /**
       * Whether this is an Obsidian-Openable Attachment. The index already
       * holds the row and the resolved path when it decides identity, so the
       * two rules a reader gesture needs — is it ours, can Obsidian host it —
       * travel in one answer instead of being recomputed per lookup.
       */
      openable: boolean;
    }
  | { kind: "unresolved" }
  | { kind: "pending" };

/**
 * An Attachment named by its Indexed Key: the same answer
 * {@link AttachmentResolution} gives for its file, with the file it keeps.
 * `unresolved` covers an Attachment Zotero does not hold and one whose row
 * names no file, such as a web link.
 */
export type AttachmentLookup =
  | (Extract<AttachmentResolution, { kind: "resolved" }> & {
      absolutePath: string;
    })
  | { kind: "unresolved" }
  | { kind: "pending" };

export interface AttachmentResolverEvents {
  /**
   * The answers {@link AttachmentResolver.resolve} gives may differ from here
   * on: a new path index replaced the one held, after the database or the
   * resolved Zotero paths moved. Raised for the first index too, so a caller
   * that was told `pending` hears the index it was waiting for arrive.
   */
  "resolutions-changed": () => void;
}

const UNRESOLVED = { kind: "unresolved" } as const;
const PENDING = { kind: "pending" } as const;

/** The query key the held path index lives under. */
const PATH_INDEX_KEY = ["attachment-resolver", "path-index"] as const;

interface PathIndex {
  /** Resolution by the lookup key of an absolute path. */
  byPath: ReadonlyMap<string, AttachmentResolution>;
  /** Every Attachment that names a file, by its Indexed Key. */
  byKey: ReadonlyMap<string, AttachedFile>;
}

/** One Attachment and the file it names, as the key side of the index holds it. */
export type AttachedFile = Extract<AttachmentLookup, { kind: "resolved" }> & {
  pathKey: string;
};

export interface AttachmentResolverDeps {
  reads: Pick<ZoteroReadsService, "ready" | "on" | "acquireRead">;
  queries: Pick<
    PlainQueryClients,
    "client" | "ask" | "invalidate" | "peek" | "watch"
  >;
  zoteroPref: Pick<ZoteroPrefService, "dataDir" | "baseAttachmentPath" | "on">;
  /**
   * The filesystem's platform, which decides whether the lookup key folds case.
   *
   * @default process.platform
   */
  platform?: NodeJS.Platform;
}

/**
 * Answers which Zotero Attachment holds the file at an absolute path, from an
 * index built by running the forward path resolver across the attachment table
 * and keying each result with `attachmentPathKey`. The index is never
 * persisted.
 *
 * The index is a Held Read (ADR 0054/0060). The first lookup starts a build
 * from the `AttachmentPathIndex` stream; the rows arrive in slices off the main
 * thread. When the database or the resolved Zotero paths move, a new build
 * starts at once, and lookups answer from the previous index until it lands.
 *
 * @see apps/obsidian/docs/adr/0035-the-attachment-resolver-case-folds-on-case-insensitive-platforms.md
 */
export class AttachmentResolver extends Service<void> {
  readonly #reads;
  readonly #queries;
  readonly #zoteroPref;
  readonly #platform;
  readonly #emitter = createNanoEvents<AttachmentResolverEvents>();
  readonly #indexed = Promise.withResolvers<void>();

  ready: Promise<void>;

  /**
   * Settles once the first index lands, from here on lookups answer for real
   * rather than `pending`. Waiting on it starts no build: something else —
   * {@link warm} or a lookup — has to ask for one.
   */
  get indexed(): Promise<void> {
    return this.#indexed.promise;
  }

  constructor({
    reads,
    queries,
    zoteroPref,
    platform = process.platform,
  }: AttachmentResolverDeps) {
    super();
    this.#reads = reads;
    this.#queries = queries;
    this.#zoteroPref = zoteroPref;
    this.#platform = platform;
    this.ready = this.#load();
  }

  on<K extends keyof AttachmentResolverEvents>(
    event: K,
    cb: AttachmentResolverEvents[K],
  ): () => void {
    return this.#emitter.on(event, cb);
  }

  /**
   * @param absolutePath the open file's absolute path, with no `file:` prefix
   *   and already through the vault adapter for an in-vault file.
   * @param options.attachmentKey the Attachment the opener named, when it named
   *   one. Two Attachments can keep one file and the path alone chooses one of
   *   them, so the named one wins — but only while it keeps this very file: a
   *   name carried over from an earlier open does not rename another file.
   * @returns `pending` while no index was built yet — the caller hears
   *   `resolutions-changed` once one is.
   */
  resolve(
    absolutePath: string,
    { attachmentKey }: { attachmentKey?: string | null } = {},
  ): AttachmentResolution {
    const index = this.#held();
    if (index === undefined) return PENDING;
    const pathKey = attachmentPathKey(absolutePath, this.#platform);
    const named =
      attachmentKey == null ? undefined : index.byKey.get(attachmentKey);
    if (named !== undefined && named.pathKey === pathKey)
      return resolutionOf(named);
    return index.byPath.get(pathKey) ?? UNRESOLVED;
  }

  /**
   * An Attachment by its Indexed Key, for a caller that holds the key rather
   * than a path: a `zotero://open` link, an Annotation card, a picker row.
   * Nothing here checks that the file is on disk.
   *
   * @returns `pending` while no index was built yet, as {@link resolve} does.
   */
  lookup(attachmentKey: string): AttachmentLookup {
    const index = this.#held();
    if (index === undefined) return PENDING;
    const named = index.byKey.get(attachmentKey);
    if (named === undefined) return UNRESOLVED;
    const { pathKey: _pathKey, ...lookup } = named;
    return lookup;
  }

  /**
   * Start the first build now, for a caller that must answer a lookup before
   * anything else asked for one: a link clicked before any PDF was opened.
   */
  warm(): void {
    this.#held();
  }

  /** The index a lookup answers from, starting a build when none is held. */
  #held(): PathIndex | undefined {
    const held = this.#queries.peek<PathIndex>(PATH_INDEX_KEY);
    // A failed build is asked again; the failure cooldown paces the retries.
    if (held === null || held.status === "failed") void this.#build();
    return held?.value;
  }

  async #load(): Promise<void> {
    await using stack = new AsyncDisposableStack();
    this.#queries.client.setQueryDefaults(PATH_INDEX_KEY, { gcTime: Infinity });
    stack.defer(
      this.#queries.watch<PathIndex>(PATH_INDEX_KEY, {
        changed: () => {
          this.#indexed.resolve();
          this.#emitter.emit("resolutions-changed");
        },
        settled: () => {},
      }),
    );
    stack.defer(
      this.#reads.on("changed", () => this.#rebuild("database changed")),
    );
    stack.defer(
      this.#zoteroPref.on("resolved-changed", () =>
        this.#rebuild("Zotero paths changed"),
      ),
    );
    this.commit(stack.move());
  }

  /**
   * Marks the held index stale and builds a new one, where a lookup asked for
   * one before. Lookups answer from the stale index until the new one lands.
   */
  #rebuild(reason: string): void {
    if (this.#queries.client.getQueryState(PATH_INDEX_KEY) === undefined) {
      return;
    }
    logger.debug("Attachment path index stale", { reason });
    this.#queries.invalidate(PATH_INDEX_KEY);
    void this.#build();
  }

  /** Builds the index into the held value; a failure keeps what it holds. */
  async #build(): Promise<void> {
    await this.#queries.ask<PathIndex>(PATH_INDEX_KEY, async ({ signal }) => {
      await using lease = await this.#reads.acquireRead();
      const { reads } = lease;
      const { serverID } = await Effect.runPromise(reads.DatabaseIdentity({}), {
        signal,
      });
      const slices = await Effect.runPromise(
        Stream.runCollect(reads.AttachmentPathIndex({})),
        { signal },
      );
      // Read after the rows: a paths change during the read starts a new
      // build, which cancels this one.
      const { index, files, collisions } = buildPathIndex(slices.flat(), {
        dataDir: this.#zoteroPref.dataDir,
        baseAttachmentPath: this.#zoteroPref.baseAttachmentPath,
        platform: this.#platform,
        serverID,
      });
      if (collisions.length > 0) {
        logger.warn("Several Zotero attachments name one file", { collisions });
      }
      logger.debug("Attachment path index built", {
        paths: index.size,
        collisions: collisions.length,
      });
      return { byPath: index, byKey: files };
    });
  }
}

export interface PathIndexContext extends AttachmentPathContext {
  platform: NodeJS.Platform;
  serverID?: string | null;
}

/** One file named by more than one Attachment, as the warning reports it. */
export type PathCollision = {
  pathKey: string;
  chosen: string;
  discarded: string[];
};

/**
 * @returns the lookup index, each Attachment with the file it keeps by its
 *   Indexed Key — every one of them, the ones a shared file's path does not
 *   choose included — and every file more than one Attachment named. The
 *   caller reports those, so the rule itself stays observable as data.
 */
export function buildPathIndex(
  attachments: readonly AttachmentWithParentKey[],
  { platform, serverID = null, ...pathContext }: PathIndexContext,
): {
  index: ReadonlyMap<string, AttachmentResolution>;
  files: ReadonlyMap<string, AttachedFile>;
  collisions: PathCollision[];
} {
  const located = attachments.flatMap((attachment) => {
    const absolutePath = attachmentAbsPath(attachment, pathContext);
    return absolutePath === null
      ? []
      : {
          attachment,
          absolutePath,
          pathKey: attachmentPathKey(absolutePath, platform),
        };
  });

  const files = new Map<string, AttachedFile>(
    located.map(({ attachment, absolutePath, pathKey }) => [
      attachment.indexedKey,
      {
        kind: "resolved",
        attachmentKey: attachment.indexedKey,
        serverID,
        itemKey: attachment.parentIndexedKey,
        openable: isPdfAttachment(attachment.contentType, absolutePath),
        absolutePath,
        pathKey,
      },
    ]),
  );
  const index = new Map<string, AttachmentResolution>();
  const collisions: PathCollision[] = [];
  for (const [pathKey, entries] of Map.groupBy(located, (e) => e.pathKey)) {
    const ranked = entries.toSorted((a, b) =>
      byPreference(a.attachment, b.attachment),
    );
    const chosen = ranked[0]!.attachment;
    index.set(pathKey, resolutionOf(files.get(chosen.indexedKey)!));
    if (ranked.length > 1) {
      collisions.push({
        pathKey,
        chosen: chosen.indexedKey,
        discarded: ranked.slice(1).map((entry) => entry.attachment.indexedKey),
      });
    }
  }
  return { index, files, collisions };
}

/** What a path resolves to, from the key side's entry for its Attachment. */
function resolutionOf({
  absolutePath: _absolutePath,
  pathKey: _pathKey,
  ...resolution
}: AttachedFile): AttachmentResolution {
  return resolution;
}

/** The personal library first, then the lowest item ID, so two runs over the
 * same rows settle on the same Attachment. */
function byPreference(
  a: AttachmentWithParentKey,
  b: AttachmentWithParentKey,
): number {
  return (
    Number(a.groupID !== null) - Number(b.groupID !== null) ||
    a.itemID - b.itemID
  );
}
