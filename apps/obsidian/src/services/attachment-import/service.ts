import { dirname as sourceDirname, isAbsolute, relative, sep } from "node:path";
import { dirname as noteDirname } from "node:path/posix";
import { debounce, FileSystemAdapter, normalizePath } from "obsidian";
import type { App } from "obsidian";

import type { TemplateLink } from "@zotlit/db";
import { createNanoEvents } from "@zotlit/shared/nanoevents";

import { copyAttachments } from "@/lib/copy-attachments";
import type {
  AttachmentCopyItem,
  AttachmentCopyResult,
} from "@/lib/copy-attachments";
import {
  ensureFolder,
  joinFolderPath,
  normalizeFolderPath,
  resolveAttachmentFolderPath,
} from "@/lib/ensure-folder";
import { getLogger } from "@/lib/log";
import { fileUrlLink, syntheticFile } from "@/lib/markdown-link";
import { normalizeFilename } from "@/services/note-feature/filename";
import { Service } from "@/services/service-base";
import type { SettingsService } from "@/services/settings/service";
import type { ZoteroPrefService } from "@/services/zotero-pref/service";

import { loadApprovedFolders, saveApprovedFolders } from "./approved-folders";
import {
  buildCanonicalRoots,
  canonicalize,
  confirmSource,
  decideSource,
  NO_ROOTS,
} from "./source";
import type {
  AttachmentSource,
  BlockedSource,
  CanonicalRoots,
  SourceOrigin,
} from "./source";

export {
  type AttachmentSource,
  type BlockedSource,
  type CanonicalRoots,
  type SourceBlock,
  type SourceOrigin,
} from "./source";

const logger = getLogger("attachment-import");

/**
 * Idle window the per-operation skip counts are pooled over before one summary
 * is announced. A batch update flushes once per note, so without pooling a run
 * over a hundred notes would announce a hundred times; every flush restarts the
 * window, leaving one summary once the run settles.
 */
const SKIP_SUMMARY_DEBOUNCE_MS = 1500;

export interface AttachmentImportServiceDeps {
  app: App;
  settings: SettingsService;
  zoteroPref: Pick<ZoteroPrefService, "dataDir" | "baseAttachmentPath"> & {
    /** Only the one event the root snapshot follows. */
    on(event: "resolved-changed", cb: () => void): () => void;
  };
}

/** Sources an operation did not import, by the stage that turned them away. */
export interface AttachmentSkipCounts {
  /** Blocked by the decision: rendered as a `file://` link, never queued. */
  blocked: number;
  /** Queued, then refused by the copy-time confirmation. */
  refused: number;
}

/** Details needed to explain a pooled skip and its next action to the user. */
export interface AttachmentSkipSummary extends AttachmentSkipCounts {
  /** Parent folders of blocked absolute linked files, unique across the run. */
  blockedFolders: readonly string[];
}

export interface AttachmentImportEvents {
  /**
   * Sources skipped over the operation that just settled, pooled so one notice
   * covers a whole run. Carries the folders the user can approve; routine logs
   * still omit source locations.
   */
  "sources-skipped": (summary: AttachmentSkipSummary) => void;
}

export interface ResolveLinkOptions {
  /** The decided source to link or copy in. */
  source: AttachmentSource;
  /** Desired in-vault filename for the imported copy; also the default link display text. */
  vaultName: string;
}

export interface AttachmentImportResult
  extends AttachmentCopyResult, AttachmentSkipCounts {}

export interface AttachmentImport {
  /**
   * Decide whether `path` may be read as an attachment source, against the
   * service's standing canonical-roots snapshot as it stands at the call.
   * Synchronous and memory-only, so a template render and a `dragstart`
   * handler can both call it inline.
   */
  decide(path: string, origin: SourceOrigin): AttachmentSource;
  /**
   * Return a {@link TemplateLink} helper — a `file://` link to the source when
   * `source` is blocked or import is disabled, or a vault link to the
   * in-vault copy otherwise. Prefix the rendered link with `!` for an embed.
   * With import enabled and `source` approved, the copy is queued lazily,
   * once, on the helper's first invocation, so an excerpt whose link is never
   * rendered imports nothing.
   */
  resolveLink(opts: ResolveLinkOptions): TemplateLink;
  flush(): Promise<AttachmentImportResult>;
  /**
   * Drop every copy queued since the last `flush()` without importing it, so
   * a handle kept across drags carries nothing from a drag that never landed.
   */
  discard(): void;
}

export class AttachmentImportService extends Service<void> {
  readonly #app;
  readonly #settings;
  readonly #zoteroPref;
  readonly #emitter = createNanoEvents<AttachmentImportEvents>();
  readonly #announceSkips = debounce(
    () => this.flushSkipSummary(),
    SKIP_SUMMARY_DEBOUNCE_MS,
    true,
  );

  /**
   * The standing canonical-roots snapshot every decision is taken against.
   * Rebuilt at service start, on a settings change — the plugin's own and
   * Zotero's resolved location alike — and at the start of each import
   * operation, so a moved base directory is followed and a drag between
   * refreshes reads a snapshot at most one operation old.
   */
  #roots: CanonicalRoots = NO_ROOTS;
  /** Monotonic rebuild token, so a slow rebuild cannot overwrite a newer one. */
  #rootsGen = 0;
  #pendingSkips: AttachmentSkipCounts = { blocked: 0, refused: 0 };
  readonly #pendingBlockedFolders = new Set<string>();
  /** Approved Attachment Roots for this vault × device, as granted. */
  #approvedFolders: readonly string[];

  ready: Promise<void>;

  constructor(deps: AttachmentImportServiceDeps) {
    super();
    this.#app = deps.app;
    this.#settings = deps.settings;
    this.#zoteroPref = deps.zoteroPref;
    this.#approvedFolders = loadApprovedFolders(deps.app);
    this.ready = this.#load();
  }

  /**
   * The folders approved on this device, canonical and in the order granted —
   * what the settings tab lists and revokes from.
   */
  get approvedFolders(): readonly string[] {
    return this.#approvedFolders;
  }

  /**
   * Permit `folder` as a source for absolute linked files on this device. The
   * record holds the folder's canonical path, so a folder later replaced by a
   * link to another location stops matching. Rebuilds the snapshot before
   * resolving, so the next import already reads the grant.
   *
   * @returns the canonical path stored, or `null` when `folder` does not
   *   resolve and nothing was granted.
   */
  async approveFolder(folder: string): Promise<string | null> {
    const canonical = await canonicalize(folder);
    if (canonical === null) {
      logger.warn("Ignored an approved folder that does not resolve");
      return null;
    }
    if (!this.#approvedFolders.includes(canonical)) {
      this.#approvedFolders = [...this.#approvedFolders, canonical];
      saveApprovedFolders(this.#app, this.#approvedFolders);
    }
    await this.#rebuildRoots();
    return canonical;
  }

  /**
   * Withdraw `folder`'s approval. Takes effect at once: the next import decides
   * against a snapshot the folder has already left.
   */
  async revokeFolder(folder: string): Promise<void> {
    const remaining = this.#approvedFolders.filter((path) => path !== folder);
    if (remaining.length === this.#approvedFolders.length) return;
    this.#approvedFolders = remaining;
    saveApprovedFolders(this.#app, remaining);
    await this.#rebuildRoots();
  }

  on<K extends keyof AttachmentImportEvents>(
    event: K,
    cb: AttachmentImportEvents[K],
  ): () => void {
    return this.#emitter.on(event, cb);
  }

  /**
   * Announce the pooled skip counts now, instead of waiting out the idle
   * window. No-op when nothing was skipped.
   */
  flushSkipSummary(): void {
    const counts = this.#pendingSkips;
    if (counts.blocked === 0 && counts.refused === 0) return;
    this.#pendingSkips = { blocked: 0, refused: 0 };
    const blockedFolders = [...this.#pendingBlockedFolders];
    this.#pendingBlockedFolders.clear();
    this.#emitter.emit("sources-skipped", { ...counts, blockedFolders });
  }

  /**
   * @param opts.folderCache - Keyed by `dirname(notePath)`; every note in the
   *   same folder resolves to the same attachment folder, so a run-scoped
   *   cache lets a batch import skip the repeated `resolveAttachmentFolderPath`
   *   probe (async when the setting is the default "use note folder").
   */
  async prepare(
    notePath: string,
    opts?: { folderCache?: Map<string, string> },
  ): Promise<AttachmentImport> {
    const settings = await this.#settings.loaded;
    const importEnabled = settings["attachment.import"];
    let folderPath: string | null = null;
    if (importEnabled) {
      const cache = opts?.folderCache;
      const cacheKey = noteDirname(notePath);
      const cached = cache?.get(cacheKey);
      if (cached !== undefined) {
        folderPath = cached;
      } else {
        folderPath = await resolveAttachmentFolderPath(
          this.#app,
          settings["attachment.folder-path"],
          notePath,
        );
        cache?.set(cacheKey, folderPath);
      }
      await this.#rebuildRoots();
    }

    logger.debug("Prepared attachment import", {
      notePath,
      importEnabled,
      folderPath,
    });

    return new AttachmentImportBatch({
      app: this.#app,
      notePath,
      folderPath,
      importEnabled,
      // Read through to the standing snapshot rather than copying it, so a
      // rebuild reaches a long-lived handle — the annot view holds one across
      // every drag out of the active note. With import switched off nothing is
      // written, so no source is judged and no skip is announced.
      roots: () => (importEnabled ? this.#roots : NO_ROOTS),
      reportSkips: (counts) => this.#reportSkips(counts),
    });
  }

  async #load(): Promise<void> {
    await using stack = new AsyncDisposableStack();
    stack.defer(() => {
      this.#announceSkips.cancel();
    });
    stack.defer(
      this.#settings.subscribe((value) => {
        if (value?.["attachment.import"]) void this.#rebuildRoots();
      }),
    );
    // Every root reads from Zotero's prefs — the data directory the storage and
    // annotation-cache roots are joined onto, and the base attachment path — so
    // a profile re-read or a data-dir override moves them all.
    stack.defer(
      this.#zoteroPref.on("resolved-changed", () => {
        void this.#rebuildRoots();
      }),
    );
    await this.#rebuildRoots();
    this.commit(stack.move());
  }

  async #rebuildRoots(): Promise<void> {
    const gen = ++this.#rootsGen;
    const roots = await buildCanonicalRoots({
      dataDir: this.#zoteroPref.dataDir,
      baseAttachmentPath: this.#zoteroPref.baseAttachmentPath,
      // Re-canonicalized on every rebuild, so an approval whose folder moved,
      // vanished, or became a link elsewhere stops matching.
      approvedFolders: this.#approvedFolders,
    });
    if (gen !== this.#rootsGen) return;
    this.#roots = roots;
  }

  #reportSkips(summary: AttachmentSkipSummary): void {
    if (summary.blocked === 0 && summary.refused === 0) return;
    this.#pendingSkips = {
      blocked: this.#pendingSkips.blocked + summary.blocked,
      refused: this.#pendingSkips.refused + summary.refused,
    };
    for (const folder of summary.blockedFolders) {
      this.#pendingBlockedFolders.add(folder);
    }
    this.#announceSkips();
  }
}

interface AttachmentImportBatchOptions {
  app: App;
  notePath: string;
  folderPath: string | null;
  importEnabled: boolean;
  /** Reads the service's standing snapshot at each call, never a copy of it. */
  roots: () => CanonicalRoots;
  reportSkips: (summary: AttachmentSkipSummary) => void;
}

/** A queued copy, carrying what the copy-time confirmation needs to judge it. */
interface PendingCopy {
  /** The decided location, re-confirmed at each flush. */
  path: string;
  origin: SourceOrigin;
  root: string;
  dest: string;
}

class AttachmentImportBatch implements AttachmentImport {
  readonly #app;
  readonly #notePath;
  readonly #folderPath;
  readonly #importEnabled;
  readonly #roots;
  readonly #reportSkips;
  readonly #items: PendingCopy[] = [];

  #blocked = 0;
  readonly #blockedFolders = new Set<string>();

  constructor(options: AttachmentImportBatchOptions) {
    this.#app = options.app;
    this.#notePath = options.notePath;
    this.#folderPath = normalizeFolderPath(options.folderPath);
    this.#importEnabled = options.importEnabled;
    this.#roots = options.roots;
    this.#reportSkips = options.reportSkips;
  }

  decide(path: string, origin: SourceOrigin): AttachmentSource {
    return decideSource(path, origin, this.#roots());
  }

  resolveLink({ source, vaultName }: ResolveLinkOptions): TemplateLink {
    if (!source.approved) return this.#blockedLink(source, vaultName);
    const sourcePath = source.path;
    if (!this.#importEnabled || this.#folderPath === null) {
      return fileUrlLink(sourcePath, vaultName);
    }

    // Reduce the row-sourced name to a single path segment before it ever
    // reaches a join — the same normalizer the note filename slot uses — so a
    // hostile Zotero attachment filename cannot route the copy outside the
    // attachment folder.
    const safeName = normalizeFilename(vaultName);
    const vaultPath = normalizePath(joinFolderPath(this.#folderPath, safeName));
    const file = syntheticFile(vaultPath);
    // Queue the copy on first render of this link, not at resolve time, so an
    // excerpt the template never embeds imports nothing.
    let queued = false;
    // generateMarkdownLink fills the default display text from the filename per
    // the vault's wikilink / Markdown preference, so the default link is never
    // blank.
    return (alias, subpath) => {
      if (!queued) {
        queued = true;
        this.#items.push({
          path: sourcePath,
          origin: source.origin,
          root: source.root,
          dest: this.#absoluteVaultPath(vaultPath, this.#folderPath!),
        });
      }
      return this.#app.fileManager.generateMarkdownLink(
        file,
        this.#notePath,
        subpath,
        alias,
      );
    };
  }

  async flush(): Promise<AttachmentImportResult> {
    // A linked-file source is confirmed by opening it, and the copy reads that
    // descriptor; this scope owns every one of them until the copy is done.
    await using descriptors = new AsyncDisposableStack();
    // Drain the queue, so a second flush confirms and counts only what was
    // queued since the first one.
    const queued = this.#items.splice(0);
    const { confirmed, refused, missing } = await this.#confirmQueue(
      queued,
      descriptors,
    );
    // Create the folder only now that a copy has cleared confirmation;
    // copyAttachments writes straight to dest and never makes the parent.
    if (confirmed.length > 0 && this.#folderPath) {
      await ensureFolder(this.#app, this.#folderPath);
    }
    const copied = await copyAttachments(confirmed);
    // Counted since the previous flush, so a re-flush never announces the same
    // skip twice.
    const skips: AttachmentSkipCounts = { blocked: this.#blocked, refused };
    this.#blocked = 0;
    const blockedFolders = [...this.#blockedFolders];
    this.#blockedFolders.clear();
    this.#reportSkips({ ...skips, blockedFolders });

    const result: AttachmentImportResult = {
      ...copied,
      missing: copied.missing + missing,
      ...skips,
    };
    logger.debug("Imported attachments", { ...result });
    return result;
  }

  discard(): void {
    const dropped = this.#items.splice(0).length;
    if (dropped > 0) {
      logger.debug("Discarded queued attachment imports", { dropped });
    }
  }

  /**
   * Render a blocked source's `file://` fallback, counting and logging it once
   * rendered. The log carries the origin and the reason only — never the
   * location — so a maintainer can support a user whose source never reached
   * the queue. With import switched off nothing is written, so nothing is
   * judged, counted, or logged.
   */
  #blockedLink(source: BlockedSource, vaultName: string): TemplateLink {
    const link = fileUrlLink(source.path, vaultName);
    if (!this.#importEnabled) return link;
    let counted = false;
    return (alias, subpath) => {
      if (!counted) {
        counted = true;
        this.#blocked += 1;
        if (source.origin === "linked-absolute") {
          this.#blockedFolders.add(sourceDirname(source.path));
        }
        logger.warn("Blocked attachment source", {
          origin: source.origin,
          reason: source.reason,
        });
      }
      return link(alias, subpath);
    };
  }

  /**
   * Confirm every queued source before a byte moves, replacing each with the
   * form its origin copies from. A refusal is logged with its origin and
   * reason only — never the location — and counted for the summary.
   *
   * @param queued - The copies drained from this batch's queue.
   * @param descriptors - Takes over every descriptor the confirmation opens, so an
   *   error part-way through the queue still closes the ones already open.
   */
  async #confirmQueue(
    queued: readonly PendingCopy[],
    descriptors: AsyncDisposableStack,
  ): Promise<{
    confirmed: AttachmentCopyItem[];
    refused: number;
    missing: number;
  }> {
    const confirmed: AttachmentCopyItem[] = [];
    let refused = 0;
    let missing = 0;
    for (const item of queued) {
      const outcome = await confirmSource(
        { path: item.path, root: item.root, origin: item.origin },
        this.#roots().caseInsensitive,
      );
      switch (outcome.status) {
        case "confirmed":
          if (outcome.source.kind === "handle") {
            descriptors.use(outcome.source.handle);
          }
          confirmed.push({ source: outcome.source, dest: item.dest });
          break;
        case "missing":
          missing += 1;
          logger.warn("Skipped attachment with missing source", {
            origin: item.origin,
          });
          break;
        case "refused":
          refused += 1;
          logger.warn("Refused attachment source", {
            origin: item.origin,
            reason: outcome.reason,
          });
          break;
      }
    }
    return { confirmed, refused, missing };
  }

  /**
   * Resolve `vaultPath` to an absolute on-disk path and confirm it still sits
   * inside the attachment folder — a hostile filename is already reduced to
   * one segment before this runs, so this is a defense-in-depth invariant,
   * not the primary containment mechanism.
   */
  #absoluteVaultPath(vaultPath: string, folderPath: string): string {
    const { adapter } = this.#app.vault;
    if (!(adapter instanceof FileSystemAdapter)) {
      throw new Error("Attachment import requires a filesystem vault adapter");
    }
    const dest = adapter.getFullPath(vaultPath);
    assertContained(adapter.getFullPath(folderPath), dest);
    return dest;
  }
}

/**
 * Throw when `dest` does not resolve inside `root`. Both are absolute,
 * platform-native paths built from trusted (settings-derived) and sanitized
 * (single-segment) components, so this should never trigger in practice —
 * it guards the invariant rather than replacing the sanitization upstream.
 */
function assertContained(root: string, dest: string): void {
  const rel = relative(root, dest);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error("Attachment destination escaped the attachment folder");
  }
}
