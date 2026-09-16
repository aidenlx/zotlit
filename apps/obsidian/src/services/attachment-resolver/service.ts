// Names the Zotero Attachment behind the absolute path of an open PDF.
import { getAllAttachments } from "@zotlit/db";
import type { AttachmentWithParentKey } from "@zotlit/db";
import { attachmentAbsPath, attachmentPathKey } from "@zotlit/db/path";
import type { AttachmentPathContext } from "@zotlit/db/path";

import { getLogger } from "@/lib/log";
import type { DatabaseService } from "@/services/database/service";
import { Service } from "@/services/service-base";
import type { ZoteroPrefService } from "@/services/zotero-pref/service";

const logger = getLogger("attachment-resolver");

/**
 * What an open PDF resolves to in the Zotero library. Both keys are Indexed
 * Keys — `key` for the personal library, `key + "g" + groupID` for a group — as
 * ADR 0033 settles and `formatIndexedKey` in `@zotlit/db` formats.
 *
 * @see apps/obsidian/docs/adr/0033-zotero-object-identity-is-the-indexed-key-server-id-is-source-data.md
 */
export type AttachmentResolution =
  | {
      kind: "resolved";
      attachmentKey: string;
      /** The parent Item's Indexed Key; `null` for a standalone Attachment. */
      itemKey: string | null;
    }
  | { kind: "unresolved" };

/** Maps the absolute path of an open PDF to its Zotero attachment. */
export type ResolveAttachment = (absolutePath: string) => AttachmentResolution;

const UNRESOLVED: AttachmentResolution = { kind: "unresolved" };

export interface AttachmentResolverDeps {
  db: Pick<DatabaseService, "state" | "client" | "on">;
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
 * and keying each result with `attachmentPathKey`. The index is built on the
 * first lookup that finds a readable database, dropped whenever the database or
 * the resolved Zotero paths move, and never persisted.
 *
 * @see apps/obsidian/docs/adr/0035-the-attachment-resolver-case-folds-on-case-insensitive-platforms.md
 */
export class AttachmentResolver extends Service<void> {
  readonly #db;
  readonly #zoteroPref;
  readonly #platform;
  #index: ReadonlyMap<string, AttachmentResolution> | null = null;

  ready: Promise<void>;

  constructor({
    db,
    zoteroPref,
    platform = process.platform,
  }: AttachmentResolverDeps) {
    super();
    this.#db = db;
    this.#zoteroPref = zoteroPref;
    this.#platform = platform;
    this.ready = this.#load();
  }

  /**
   * @param absolutePath the open file's absolute path, with no `file:` prefix
   *   and already through the vault adapter for an in-vault file.
   */
  resolve(absolutePath: string): AttachmentResolution {
    const index = this.#index ?? this.#build();
    if (index === null) return UNRESOLVED;
    return (
      index.get(attachmentPathKey(absolutePath, this.#platform)) ?? UNRESOLVED
    );
  }

  async #load(): Promise<void> {
    await using stack = new AsyncDisposableStack();
    stack.defer(this.#db.on("changed", () => this.#drop("database changed")));
    stack.defer(
      this.#zoteroPref.on("resolved-changed", () =>
        this.#drop("Zotero paths changed"),
      ),
    );
    this.commit(stack.move());
  }

  #drop(reason: string): void {
    if (this.#index === null) return;
    this.#index = null;
    logger.debug("Attachment path index dropped", { reason });
  }

  /**
   * @returns the index, or `null` while the database cannot be read — nothing is
   *   cached then, so the next lookup asks again. The database service settles
   *   the Zotero preferences before it reports ready, so the paths the index is
   *   built from are the resolved ones.
   */
  #build(): ReadonlyMap<string, AttachmentResolution> | null {
    if (this.#db.state !== "ready") {
      logger.trace("Attachment path index not built", {
        database: this.#db.state,
      });
      return null;
    }
    const { index, collisions } = buildPathIndex(
      getAllAttachments(this.#db.client),
      {
        dataDir: this.#zoteroPref.dataDir,
        baseAttachmentPath: this.#zoteroPref.baseAttachmentPath,
        platform: this.#platform,
      },
    );
    if (collisions.length > 0) {
      logger.warn("Several Zotero attachments name one file", { collisions });
    }
    this.#index = index;
    logger.debug("Attachment path index built", {
      paths: index.size,
      collisions: collisions.length,
    });
    return index;
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
      : { attachment, pathKey: attachmentPathKey(absolutePath, platform) };
  });

  const index = new Map<string, AttachmentResolution>();
  const collisions: PathCollision[] = [];
  for (const [pathKey, entries] of Map.groupBy(located, (e) => e.pathKey)) {
    const ranked = entries
      .map((entry) => entry.attachment)
      .toSorted(byPreference);
    const chosen = ranked[0]!;
    index.set(pathKey, {
      kind: "resolved",
      attachmentKey: chosen.indexedKey,
      itemKey: chosen.parentIndexedKey,
    });
    if (ranked.length > 1) {
      collisions.push({
        pathKey,
        chosen: chosen.indexedKey,
        discarded: ranked.slice(1).map((attachment) => attachment.indexedKey),
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
