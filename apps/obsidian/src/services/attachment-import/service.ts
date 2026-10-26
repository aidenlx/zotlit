// Attachment Import: decides which files a note may copy into the vault, against
// the trusted roots and the folders approved on this device, and copies them.
import {
  Context,
  Duration,
  Effect,
  FileSystem,
  Layer,
  Option,
  PubSub,
  Queue,
  Ref,
  Schema,
  Semaphore,
  Stream,
  SubscriptionRef,
} from "effect";
import type { PlatformError } from "effect";
import {
  dirname as sourceDirname,
  isAbsolute,
  join,
  relative,
  sep,
} from "node:path";
import { dirname as noteDirname } from "node:path/posix";
import { normalizePath, TFile, TFolder } from "obsidian";

import type { TemplateLink } from "@zotlit/db";
import { normalizeFilename } from "@zotlit/templates";

import { attachmentFolderPath } from "@/lib/attachment-folder";
import { copyAttachments } from "@/lib/copy-attachments";
import type {
  AttachmentCopyItem,
  AttachmentCopyResult,
} from "@/lib/copy-attachments";
import { withLogCategory } from "@/lib/effect-log";
import { forkEach } from "@/lib/effect-stream";
import { joinFolderPath, normalizeFolderPath } from "@/lib/ensure-folder";
import type { SystemCallError } from "@/lib/errno";
import { fileUrlLink, syntheticFile } from "@/lib/markdown-link";
import { DeviceStorage } from "@/lib/obsidian-device-storage";
import type { DeviceStorageError } from "@/lib/obsidian-device-storage";
import { ObsidianEnv } from "@/lib/obsidian-env";
import { FileManager } from "@/lib/obsidian-file-manager";
import { Vault } from "@/lib/obsidian-vault";
import type { VaultError } from "@/lib/vault-errors";
import { PluginSettings } from "@/services/settings/service";
import { resolvedChanged, ZoteroPref } from "@/services/zotero-pref/service";

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

const logged = withLogCategory("attachment-import");

/**
 * Idle window the per-operation skip counts are pooled over before one summary
 * is announced. A batch update flushes once per note, so without pooling a run
 * over a hundred notes would announce a hundred times; every flush restarts the
 * window, leaving one summary once the run settles.
 */
const SKIP_SUMMARY_DEBOUNCE = Duration.millis(1500);

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

export interface ResolveLinkOptions {
  /** The decided source to link or copy in. */
  source: AttachmentSource;
  /** Desired in-vault filename for the imported copy; also the default link display text. */
  vaultName: string;
}

export interface AttachmentImportResult
  extends AttachmentCopyResult, AttachmentSkipCounts {}

/** A file, not a folder, holds the attachment folder's path. */
export class AttachmentFolderError extends Schema.TaggedError<
  AttachmentFolderError,
  { readonly brand: unique symbol }
>()("AttachmentFolderError", {
  /** The attachment folder's vault path. */
  path: Schema.String,
}) {
  override get message(): string {
    return `Cannot create folder; a file exists at "${this.path}"`;
  }
}

/** The copy of confirmed sources failed; `cause` holds what it threw. */
export class AttachmentCopyError extends Schema.TaggedError<
  AttachmentCopyError,
  { readonly brand: unique symbol }
>()("AttachmentCopyError", {
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

/** What a flush fails with: a source check, the folder, or the copy. */
export type AttachmentFlushError =
  | PlatformError.PlatformError
  | SystemCallError
  | AttachmentFolderError
  | AttachmentCopyError
  | VaultError;

/** One note's imports: the decisions a render takes, and the copies it queued. */
export interface AttachmentImportBatch {
  /**
   * Decide whether `path` may be read as an attachment source, against the
   * service's standing canonical-roots snapshot as it stands at the call.
   * Synchronous and memory-only, so a template render can call it inline.
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
  /** Confirm and copy what was queued since the last flush. */
  readonly flush: Effect.Effect<AttachmentImportResult, AttachmentFlushError>;
  /**
   * Drop every copy queued since the last `flush` without importing it, so
   * a handle kept across drags carries nothing from a drag that never landed.
   */
  readonly discard: Effect.Effect<void>;
}

export interface PrepareOptions {
  /**
   * Keyed by `dirname(notePath)`; every note in the same folder resolves to
   * the same attachment folder, so a run-scoped cache lets a batch import skip
   * the repeated attachment folder lookup.
   */
  folderCache?: Map<string, string>;
}

/**
 * Attachment Import: the folders approved as attachment sources on this
 * device, and the per-note batch that decides and copies sources.
 */
export class AttachmentImport extends Context.Service<
  AttachmentImport,
  {
    /**
     * The folders approved on this device, canonical and in the order granted —
     * what the settings tab lists and revokes from.
     */
    readonly approvedFolders: Effect.Effect<readonly string[]>;
    /**
     * The approved folders now, then after each approve or revoke that
     * changes them. Ends when the layer closes.
     */
    readonly approvedFoldersChanges: Stream.Stream<readonly string[]>;
    /**
     * Permit `folder` as a source for absolute linked files on this device. The
     * record holds the folder's canonical path, so a folder later replaced by a
     * link to another location stops matching. Rebuilds the snapshot before it
     * succeeds, so the next import already reads the grant.
     *
     * Succeeds with the canonical path stored, or `null` when `folder` does not
     * resolve and nothing was granted.
     */
    approveFolder(
      folder: string,
    ): Effect.Effect<string | null, DeviceStorageError>;
    /**
     * Withdraw `folder`'s approval. Takes effect at once: the next import
     * decides against a snapshot the folder has already left.
     */
    revokeFolder(folder: string): Effect.Effect<void, DeviceStorageError>;
    /**
     * Sources skipped over the operations that just settled, pooled so one
     * notice covers a whole run. Carries the folders the user can approve;
     * routine logs still omit source locations. Ends when the layer closes.
     */
    readonly skipped: Stream.Stream<AttachmentSkipSummary>;
    /** The import batch for the note at `notePath`. */
    prepare(
      notePath: string,
      options?: PrepareOptions,
    ): Effect.Effect<AttachmentImportBatch, VaultError>;
  }
>()("zotlit/attachment-import/AttachmentImport") {}

/** What the layer reads. */
export type AttachmentImportServices =
  | PluginSettings
  | ZoteroPref
  | FileManager
  | Vault
  | ObsidianEnv
  | DeviceStorage
  | FileSystem.FileSystem;

/** A queued copy, carrying what the copy-time confirmation needs to judge it. */
interface PendingCopy {
  /** The decided location, re-confirmed at each flush. */
  path: string;
  origin: SourceOrigin;
  root: string;
  dest: string;
}

const NO_SKIPS: AttachmentSkipSummary = {
  blocked: 0,
  refused: 0,
  blockedFolders: [],
};

/**
 * Attachment Import over the plugin's services. `platform` decides whether
 * paths compare without case; it defaults to this process's.
 */
export const layerAttachmentImport = (
  options: { readonly platform?: NodeJS.Platform } = {},
): Layer.Layer<AttachmentImport, never, AttachmentImportServices> =>
  Layer.effect(
    AttachmentImport,
    Effect.gen(function* () {
      const platform = options.platform ?? process.platform;
      const settings = yield* PluginSettings;
      const pref = yield* ZoteroPref;
      const fileManager = yield* FileManager;
      const vault = yield* Vault;
      const { basePath } = yield* ObsidianEnv;
      const fs = yield* FileSystem.FileSystem;
      const storage = yield* DeviceStorage;
      const save = (folders: readonly string[]) =>
        saveApprovedFolders(folders).pipe(
          Effect.provideService(DeviceStorage, storage),
        );
      // A render decides and links synchronously, so it reads the snapshot and
      // the file manager through this runner.
      const runSync = Effect.runSyncWith(yield* Effect.context<never>());

      // Obsidian's device store catches its own errors, so a failure here is
      // a defect, and the layer fails with it.
      const approved = yield* SubscriptionRef.make<readonly string[]>(
        yield* Effect.orDie(loadApprovedFolders),
      );
      /**
       * The standing canonical-roots snapshot every decision is taken against.
       * Rebuilt at start, on a settings change — the plugin's own and Zotero's
       * resolved location alike — and at the start of each import operation,
       * so a moved base directory is followed and a drag between refreshes
       * reads a snapshot at most one operation old.
       */
      const roots = yield* Ref.make<CanonicalRoots>(NO_ROOTS);
      // One rebuild at a time, so the last one started is the one that stays.
      const rebuilding = yield* Semaphore.make(1);
      const rebuildRoots = rebuilding.withPermits(1)(
        Effect.gen(function* () {
          const { dataDir, baseAttachmentPath } = yield* pref.current;
          const built = yield* buildCanonicalRoots(
            {
              dataDir,
              baseAttachmentPath,
              // Re-canonicalized on every rebuild, so an approval whose folder
              // moved, vanished, or became a link elsewhere stops matching.
              approvedFolders: yield* SubscriptionRef.get(approved),
            },
            platform,
          );
          yield* Ref.set(roots, built);
        }).pipe(Effect.provideService(FileSystem.FileSystem, fs)),
      );

      const pending = yield* Ref.make(NO_SKIPS);
      const nudges = yield* Queue.unbounded<void>();
      const skipped = yield* PubSub.unbounded<AttachmentSkipSummary>();
      yield* Effect.addFinalizer(() => PubSub.shutdown(skipped));
      // The pooled counts are announced once the window passes with no new
      // skip. Closing the layer drops a summary still waiting.
      yield* forkEach(
        Stream.fromQueue(nudges).pipe(Stream.debounce(SKIP_SUMMARY_DEBOUNCE)),
        () =>
          Effect.gen(function* () {
            const summary = yield* Ref.getAndSet(pending, NO_SKIPS);
            if (summary.blocked === 0 && summary.refused === 0) return;
            yield* PubSub.publish(skipped, summary);
          }),
      );
      const reportSkips = (summary: AttachmentSkipSummary) =>
        summary.blocked === 0 && summary.refused === 0
          ? Effect.void
          : Ref.update(pending, (before) => ({
              blocked: before.blocked + summary.blocked,
              refused: before.refused + summary.refused,
              blockedFolders: [
                ...new Set([
                  ...before.blockedFolders,
                  ...summary.blockedFolders,
                ]),
              ],
            })).pipe(Effect.andThen(Queue.offer(nudges, undefined)));

      // Every root reads from Zotero's prefs — the data directory the storage
      // and annotation-cache roots are joined onto, and the base attachment
      // path — so a profile re-read or a data-dir override moves them all.
      yield* forkEach(
        Stream.merge(
          settings.changes.pipe(
            Stream.filter((value) => value["attachment.import"]),
          ),
          resolvedChanged(pref),
        ),
        () => rebuildRoots,
      );
      yield* rebuildRoots;

      const ensureFolder = Effect.fnUntraced(function* (folderPath: string) {
        if (folderPath === "/") return;
        const existing = yield* vault.getAbstractFileByPath(folderPath);
        if (existing instanceof TFolder) return;
        if (existing instanceof TFile)
          return yield* new AttachmentFolderError({ path: folderPath });
        yield* vault.createFolder(folderPath);
      });

      const makeBatch = (input: {
        readonly notePath: string;
        readonly folderPath: string | null;
        readonly importEnabled: boolean;
      }): AttachmentImportBatch => {
        const { notePath, importEnabled } = input;
        const folderPath = normalizeFolderPath(input.folderPath);
        // Read through to the standing snapshot rather than copying it, so a
        // rebuild reaches a long-lived handle — the annot view holds one
        // across every drag out of the active note. With import switched off
        // nothing is written, so no source is judged and no skip is announced.
        const rootsNow = importEnabled
          ? Ref.get(roots)
          : Effect.succeed(NO_ROOTS);
        const items: PendingCopy[] = [];
        let blocked = 0;
        const blockedFolders = new Set<string>();

        /**
         * Render a blocked source's `file://` fallback, counting and logging it
         * once rendered. The log carries the origin and the reason only —
         * never the location — so a maintainer can support a user whose source
         * never reached the queue. With import switched off nothing is
         * written, so nothing is judged, counted, or logged.
         */
        const blockedLink = (
          source: BlockedSource,
          vaultName: string,
        ): TemplateLink => {
          const link = fileUrlLink(source.path, vaultName);
          if (!importEnabled) return link;
          let counted = false;
          return (alias, subpath) => {
            if (!counted) {
              counted = true;
              blocked += 1;
              if (source.origin === "linked-absolute") {
                blockedFolders.add(sourceDirname(source.path));
              }
              runSync(
                Effect.logWarning("Blocked attachment source").pipe(
                  Effect.annotateLogs({
                    origin: source.origin,
                    reason: source.reason,
                  }),
                  logged,
                ),
              );
            }
            return link(alias, subpath);
          };
        };

        /**
         * Confirm every queued source before a byte moves, replacing each with
         * the form its origin copies from. A refusal is logged with its origin
         * and reason only — never the location — and counted for the summary.
         * Every descriptor the confirmation opens belongs to the Scope.
         */
        const confirmQueue = Effect.fnUntraced(function* (
          queued: readonly PendingCopy[],
        ) {
          const confirmed: AttachmentCopyItem[] = [];
          let refused = 0;
          let missing = 0;
          for (const item of queued) {
            const { caseInsensitive } = yield* rootsNow;
            const outcome = yield* confirmSource(
              { path: item.path, root: item.root, origin: item.origin },
              caseInsensitive,
            );
            switch (outcome.status) {
              case "confirmed":
                confirmed.push({ source: outcome.source, dest: item.dest });
                break;
              case "missing":
                missing += 1;
                yield* Effect.logWarning(
                  "Skipped attachment with missing source",
                ).pipe(Effect.annotateLogs({ origin: item.origin }));
                break;
              case "refused":
                refused += 1;
                yield* Effect.logWarning("Refused attachment source").pipe(
                  Effect.annotateLogs({
                    origin: item.origin,
                    reason: outcome.reason,
                  }),
                );
                break;
            }
          }
          return { confirmed, refused, missing };
        });

        return {
          decide: (path, origin) =>
            decideSource(path, origin, runSync(rootsNow)),
          resolveLink: ({ source, vaultName }) => {
            if (!source.approved) return blockedLink(source, vaultName);
            const sourcePath = source.path;
            if (!importEnabled || folderPath === null) {
              return fileUrlLink(sourcePath, vaultName);
            }
            // Reduce the row-sourced name to a single path segment before it
            // ever reaches a join — the same normalizer the note filename slot
            // uses — so a hostile Zotero attachment filename cannot route the
            // copy outside the attachment folder.
            const safeName = normalizeFilename(vaultName);
            const vaultPath = normalizePath(
              joinFolderPath(folderPath, safeName),
            );
            const file = syntheticFile(vaultPath);
            // Queue the copy on first render of this link, not at resolve
            // time, so an excerpt the template never embeds imports nothing.
            let queued = false;
            // generateMarkdownLink fills the default display text from the
            // filename per the vault's wikilink / Markdown preference, so the
            // default link is never blank.
            return (alias, subpath) => {
              if (!queued) {
                queued = true;
                items.push({
                  path: sourcePath,
                  origin: source.origin,
                  root: source.root,
                  dest: absoluteVaultPath(basePath, vaultPath, folderPath),
                });
              }
              return runSync(
                fileManager.generateMarkdownLink(file, notePath, {
                  ...(subpath === undefined ? {} : { subpath }),
                  ...(alias === undefined ? {} : { alias }),
                }),
              );
            };
          },
          flush: Effect.gen(function* () {
            // Drain the queue, so a second flush confirms and counts only what
            // was queued since the first one.
            const queued = items.splice(0);
            // A linked-file source is confirmed by opening it, and the copy
            // reads that descriptor; this scope owns every one of them until
            // the copy is done.
            const { copied, refused, missing } = yield* Effect.scoped(
              Effect.gen(function* () {
                const confirmation = yield* confirmQueue(queued);
                // Create the folder only now that a copy has cleared
                // confirmation; copyAttachments writes straight to dest and
                // never makes the parent.
                if (confirmation.confirmed.length > 0 && folderPath) {
                  yield* ensureFolder(folderPath);
                }
                const copies = yield* Effect.tryPromise({
                  try: () => copyAttachments(confirmation.confirmed),
                  catch: (cause) =>
                    new AttachmentCopyError({
                      message:
                        cause instanceof Error ? cause.message : String(cause),
                      cause,
                    }),
                });
                return { ...confirmation, copied: copies };
              }),
            );
            // Counted since the previous flush, so a re-flush never announces
            // the same skip twice.
            const skips: AttachmentSkipCounts = { blocked, refused };
            blocked = 0;
            const folders = [...blockedFolders];
            blockedFolders.clear();
            yield* reportSkips({ ...skips, blockedFolders: folders });

            const result: AttachmentImportResult = {
              ...copied,
              missing: copied.missing + missing,
              ...skips,
            };
            yield* Effect.logDebug("Imported attachments").pipe(
              Effect.annotateLogs({ ...result }),
            );
            return result;
          }).pipe(
            Effect.provideService(FileSystem.FileSystem, fs),
            logged,
            Effect.withSpan("AttachmentImport.flush"),
          ),
          discard: Effect.gen(function* () {
            const dropped = items.splice(0).length;
            if (dropped > 0) {
              yield* Effect.logDebug(
                "Discarded queued attachment imports",
              ).pipe(Effect.annotateLogs({ dropped }), logged);
            }
          }),
        };
      };

      return AttachmentImport.of({
        approvedFolders: SubscriptionRef.get(approved),
        approvedFoldersChanges: SubscriptionRef.changes(approved),
        approveFolder: Effect.fn("AttachmentImport.approveFolder")(
          function* (folder) {
            const canonical = yield* canonicalize(folder).pipe(
              Effect.provideService(FileSystem.FileSystem, fs),
            );
            if (canonical === null) {
              yield* Effect.logWarning(
                "Ignored an approved folder that does not resolve",
              ).pipe(logged);
              return null;
            }
            yield* SubscriptionRef.updateSomeEffect(approved, (folders) => {
              if (folders.includes(canonical)) return Effect.succeedNone;
              const granted = [...folders, canonical];
              return save(granted).pipe(Effect.as(Option.some(granted)));
            });
            yield* rebuildRoots;
            return canonical;
          },
        ),
        revokeFolder: Effect.fn("AttachmentImport.revokeFolder")(
          function* (folder) {
            const revoked = yield* SubscriptionRef.modifySomeEffect(
              approved,
              (folders) => {
                const remaining = folders.filter((path) => path !== folder);
                if (remaining.length === folders.length)
                  return Effect.succeed([false, Option.none()] as const);
                return save(remaining).pipe(
                  Effect.as([true, Option.some(remaining)] as const),
                );
              },
            );
            if (revoked) yield* rebuildRoots;
          },
        ),
        skipped: Stream.fromPubSub(skipped),
        prepare: Effect.fn("AttachmentImport.prepare")(
          function* (notePath, prepareOptions) {
            const current = yield* settings.current;
            const importEnabled = current["attachment.import"];
            let folderPath: string | null = null;
            if (importEnabled) {
              const cache = prepareOptions?.folderCache;
              const cacheKey = noteDirname(notePath);
              const cached = cache?.get(cacheKey);
              if (cached === undefined) {
                folderPath = yield* attachmentFolderPath(
                  current["attachment.folder-path"],
                  notePath,
                ).pipe(Effect.provideService(FileManager, fileManager));
                cache?.set(cacheKey, folderPath);
              } else {
                folderPath = cached;
              }
              yield* rebuildRoots;
            }
            yield* Effect.logDebug("Prepared attachment import").pipe(
              Effect.annotateLogs({ notePath, importEnabled, folderPath }),
              logged,
            );
            return makeBatch({ notePath, folderPath, importEnabled });
          },
        ),
      });
    }),
  );

/**
 * The on-disk path of `vaultPath`, held to the attachment folder — a hostile
 * filename is already reduced to one segment before this runs, so this is a
 * defense-in-depth invariant, not the primary containment mechanism.
 */
function absoluteVaultPath(
  basePath: string,
  vaultPath: string,
  folderPath: string,
): string {
  const dest = join(basePath, vaultPath);
  assertContained(join(basePath, folderPath), dest);
  return dest;
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
