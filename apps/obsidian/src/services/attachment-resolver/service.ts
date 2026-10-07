// Names the Zotero Attachment behind the absolute path of an open PDF.
import { Effect, Stream } from "effect";

import type { AttachmentWithParentKey } from "@zotlit/db";
import { attachmentAbsPath, attachmentPathKey } from "@zotlit/db/path";
import type { AttachmentPathContext } from "@zotlit/db/path";
import { createNanoEvents } from "@zotlit/shared/nanoevents";

import { getLogger } from "@/lib/log";
import { isPdfAttachment } from "@/services/attachment-open/resolve";
import type { QueryClientService } from "@/services/query-client/service";
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

export interface AttachmentResolverEvents {
  /**
   * The answers {@link AttachmentResolver.resolve} gives may differ from here
   * on: a new path index replaced the one held, after the database or the
   * resolved Zotero paths moved. Raised for the first index too, so a caller
   * that was told `pending` hears the index it was waiting for arrive.
   */
  "resolutions-changed": () => void;
}

const UNRESOLVED: AttachmentResolution = { kind: "unresolved" };
const PENDING: AttachmentResolution = { kind: "pending" };

/** The query key the held path index lives under. */
const PATH_INDEX_KEY = ["attachment-resolver", "path-index"] as const;

type PathIndex = ReadonlyMap<string, AttachmentResolution>;

export interface AttachmentResolverDeps {
  reads: Pick<ZoteroReadsService, "ready" | "on">;
  queries: Pick<
    QueryClientService,
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

  ready: Promise<void>;

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
   * @returns `pending` while no index was built yet — the caller hears
   *   `resolutions-changed` once one is.
   */
  resolve(absolutePath: string): AttachmentResolution {
    const held = this.#queries.peek<PathIndex>(PATH_INDEX_KEY);
    // A failed build is asked again; the failure cooldown paces the retries.
    if (held === null || held.status === "failed") void this.#build();
    const index = held?.value;
    if (index === undefined) return PENDING;
    return (
      index.get(attachmentPathKey(absolutePath, this.#platform)) ?? UNRESOLVED
    );
  }

  async #load(): Promise<void> {
    await using stack = new AsyncDisposableStack();
    this.#queries.client.setQueryDefaults(PATH_INDEX_KEY, { gcTime: Infinity });
    stack.defer(
      this.#queries.watch<PathIndex>(PATH_INDEX_KEY, {
        changed: () => this.#emitter.emit("resolutions-changed"),
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
      const { reads } = await this.#reads.ready;
      const slices = await Effect.runPromise(
        Stream.runCollect(reads.AttachmentPathIndex({})),
        { signal },
      );
      // Read after the rows: a paths change during the read starts a new
      // build, which cancels this one.
      const { index, collisions } = buildPathIndex(slices.flat(), {
        dataDir: this.#zoteroPref.dataDir,
        baseAttachmentPath: this.#zoteroPref.baseAttachmentPath,
        platform: this.#platform,
      });
      if (collisions.length > 0) {
        logger.warn("Several Zotero attachments name one file", { collisions });
      }
      logger.debug("Attachment path index built", {
        paths: index.size,
        collisions: collisions.length,
      });
      return index;
    });
  }
}

export interface PathIndexContext extends AttachmentPathContext {
  platform: NodeJS.Platform;
}

/** One file named by more than one Attachment, as the warning reports it. */
export type PathCollision = {
  pathKey: string;
  chosen: string;
  discarded: string[];
};

/**
 * @returns the lookup index, beside every file more than one Attachment named —
 *   the caller reports those, so the rule itself stays observable as data.
 */
export function buildPathIndex(
  attachments: readonly AttachmentWithParentKey[],
  { platform, ...pathContext }: PathIndexContext,
): {
  index: ReadonlyMap<string, AttachmentResolution>;
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

  const index = new Map<string, AttachmentResolution>();
  const collisions: PathCollision[] = [];
  for (const [pathKey, entries] of Map.groupBy(located, (e) => e.pathKey)) {
    const ranked = entries.toSorted((a, b) =>
      byPreference(a.attachment, b.attachment),
    );
    const { attachment: chosen, absolutePath: chosenPath } = ranked[0]!;
    index.set(pathKey, {
      kind: "resolved",
      attachmentKey: chosen.indexedKey,
      itemKey: chosen.parentIndexedKey,
      openable: isPdfAttachment(chosen.contentType, chosenPath),
    });
    if (ranked.length > 1) {
      collisions.push({
        pathKey,
        chosen: chosen.indexedKey,
        discarded: ranked.slice(1).map((entry) => entry.attachment.indexedKey),
      });
    }
  }
  return { index, collisions };
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
