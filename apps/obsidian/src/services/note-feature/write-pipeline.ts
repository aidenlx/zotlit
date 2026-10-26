// The Note Feature writes: create, update, overwrite, rewrite and Profile switch.
import { Cause, DateTime, Effect, Fiber, Option, Result, Stream } from "effect";
import { getFrontMatterInfo } from "obsidian";
import type { TFile } from "obsidian";

import { buildNoteContextFromSource } from "@zotlit/db";
import type { Item, NoteSource, NoteTemplateContext } from "@zotlit/db";
import type { UpdateScope } from "@zotlit/protocol";
import { evalManagedFrontmatterEntries } from "@zotlit/templates/frontmatter";
import { replaceManagedRegion } from "@zotlit/templates/obsidian";

import {
  FIELD_LITERATURE_NOTE_PROFILE,
  FIELD_ZOTERO_KEY,
} from "@/lib/constants";
import { recover } from "@/lib/effect-cause";
import { toInstant } from "@/lib/effect-clock";
import { processLiveText } from "@/lib/effect-live-text";
import { withLogCategory } from "@/lib/effect-log";
import { filterTag } from "@/lib/effect-stream";
import { parseFrontMatter, spliceFrontMatter } from "@/lib/live-text";
import { FileManager } from "@/lib/obsidian-file-manager";
import { MetadataCache } from "@/lib/obsidian-metadata-cache";
import { Vault } from "@/lib/obsidian-vault";
import type { Workspace } from "@/lib/obsidian-workspace";
import {
  DEFAULT_PROFILE,
  parseProfileStamp,
  profileStampOf,
} from "@/lib/profile-stamp";
import type { ProfileId, ProfileSelector } from "@/lib/profile-stamp";
import { ensureVaultParentFolder } from "@/lib/vault-folder";
import { AttachmentImport } from "@/services/attachment-import/service";
import type { AttachmentImportBatch } from "@/services/attachment-import/service";
import { outcomeScope } from "@/services/excerpt-image/outcome-scope";
import type { ExcerptOutcomeScope } from "@/services/excerpt-image/outcome-scope";
import {
  nonEmptySummary,
  ExcerptPreparation,
} from "@/services/excerpt-image/prepare";
import type {
  ExcerptSummary,
  PreparedExcerpts,
} from "@/services/excerpt-image/prepare";
import {
  itemKeyFromFrontmatter,
  noteKeyFromFrontmatter,
  NoteIndex,
} from "@/services/note-index/service";
import { noteProfileSelector } from "@/services/profile/bindings";
import type { ResolvedProfile } from "@/services/profile/bindings";
import { relocatedNotePath } from "@/services/profile/relocation";
import { Profile } from "@/services/profile/service";
import type { Settings } from "@/services/settings/schema";
import { PluginSettings } from "@/services/settings/service";
import { syncTemplate } from "@/services/template-workbench/sync-template";
import { InertTemplateError } from "@/services/template/errors";
import { Template } from "@/services/template/service";
import type { ResolvedLiteratureNoteTemplate } from "@/services/template/service";
import { ZoteroPref } from "@/services/zotero-pref/service";
import { ZoteroReads } from "@/services/zotero-reads/service";
import type { ZoteroReadsApi } from "@/services/zotero-reads/service";

import { applyComposedFrontmatter, composeLiteratureNote } from "./compose";
import type { ComposeFrontmatterInput, ComposeNoteDeps } from "./compose";
import { buildNoteResolvers, itemFacets } from "./context";
import type { NoteResolverServices } from "./context";
import {
  frontmatterRefusal,
  NO_BODY_UPDATE,
  refusedCreate,
  refusedMissingDocument,
  refusedProfileConflict,
  refusedTemplateConversion,
  refusedUnknownProfile,
  refusedUpdateMissingDocument,
  refusedUpdateProfile,
  refusedUpdateProfileConflict,
  refusedUpdateTemplateConversion,
} from "./diagnostics";
import {
  ItemNotFound,
  NoteWriteAborted,
  ProfileSwitchRollbackFailed,
} from "./errors";
import { prepareManagedFrontmatter } from "./frontmatter";
import { resolveNotePath } from "./note-path";
import {
  readItem,
  relocationSource,
  resolveProfileDocument,
} from "./note-reads";
import type {
  CreateNoteInternalOptions,
  CreateNoteResult,
  NoteFeatureEvent,
  NoteKeyChangedDiagnostic,
  NoteProfileChangedDiagnostic,
  UpdateResult,
  WriteNoteUpdateOptions,
} from "./types";

const logged = withLogCategory("note-feature");

/** The services the note writes read through their tags. */
export type NoteWriteServices =
  | AttachmentImport
  | ExcerptPreparation
  | FileManager
  | MetadataCache
  | NoteIndex
  | PluginSettings
  | Profile
  | Template
  | Vault
  | Workspace
  | ZoteroPref
  | ZoteroReads;

/** What every write of one Note Feature shares. */
export interface NoteWriteContext {
  /**
   * Raises a Note Feature event at once, from inside a render's synchronous
   * callback as well as from Effect code.
   */
  readonly emit: (event: NoteFeatureEvent) => void;
}

/** The pipeline's options for one create, beyond what a caller hands in. */
type CreateNoteWriteOptions = CreateNoteInternalOptions & {
  /** Runs once the note exists, before its attachments flush. */
  onFileCreated?: (file: TFile) => Effect.Effect<void>;
};

/**
 * The frontmatter-eval event as the composition raises it, inside a render's
 * synchronous callback.
 */
export const composeEvents = (
  ctx: NoteWriteContext,
): NonNullable<ComposeNoteDeps["events"]> => ({
  emit: (_event, payload) =>
    ctx.emit({ _tag: "frontmatter-eval-failed", payload }),
});

/** The reads `use` runs on: the batch's Snapshot, or one of its own. */
const withReads = <A, E, R>(
  provided: ZoteroReadsApi | undefined,
  use: (reads: ZoteroReadsApi) => Effect.Effect<A, E, R>,
) =>
  provided
    ? use(provided)
    : Effect.scoped(
        Effect.flatMap(
          Effect.flatMap(ZoteroReads, (zoteroReads) => zoteroReads.snapshot),
          (reads) => use(reads),
        ),
      );

/**
 * The resolvers of one note's render, over the write's services and the
 * Zotero data directory as it stands now.
 */
const noteResolvers = Effect.fnUntraced(function* (
  options: Omit<Parameters<typeof buildNoteResolvers>[1], "zoteroPref">,
) {
  const { dataDir, baseAttachmentPath } = yield* (yield* ZoteroPref).current;
  return buildNoteResolvers(
    Effect.runSyncWith(yield* Effect.context<NoteResolverServices>()),
    { ...options, zoteroPref: { dataDir, baseAttachmentPath } },
  );
});

/**
 * What a note write at `path` fails with for `cause`, a throw that stopped it:
 * an inert Template's refusal as itself, so it stays a typed failure, and
 * anything else as {@link NoteWriteAborted}.
 */
const aborted = (path: string, cause: unknown) =>
  cause instanceof InertTemplateError
    ? cause
    : new NoteWriteAborted({ path, cause });

/** A render for the note at `path`; a throw fails as {@link aborted} gives it. */
const renderFor = (path: string, render: () => string) =>
  Effect.try({ try: render, catch: (cause) => aborted(path, cause) });

/**
 * The bound feature serializes calls by Indexed Key before this operation.
 * This operation checks the settled Note Index before it writes. The path was
 * found free in the vault cache when it was resolved; a note that took it
 * since fails the create with `FileExists`.
 *
 * Fails with `NotePathUnavailable` when the rendered filename is empty or
 * every `suffix()` attempt collides, and with `FileExists` or `VaultError`
 * when Obsidian refuses the create.
 */
export const createNote = Effect.fnUntraced(function* (
  ctx: NoteWriteContext,
  item: Item,
  options: CreateNoteWriteOptions = {},
) {
  const noteIndex = yield* NoteIndex;
  const profiles = yield* Profile;
  yield* noteIndex.whenIndexed;
  const settings = yield* (yield* PluginSettings).current;
  const requestedProfile = options.profile ?? DEFAULT_PROFILE;
  const profile = yield* profiles.resolveProfile(requestedProfile);
  if (!profile) {
    return refusedUnknownProfile(requestedProfile, {
      indexedKey: item.indexedKey,
    }) satisfies CreateNoteResult as CreateNoteResult;
  }
  if (conversionRequired(settings, requestedProfile)) {
    return refusedTemplateConversion(requestedProfile, {
      indexedKey: item.indexedKey,
    }) satisfies CreateNoteResult as CreateNoteResult;
  }
  const existing = yield* noteIndex.getNotesByItemKey(item.indexedKey);
  if (existing.length > 0) {
    if (existing.length === 1 && options.profile !== undefined) {
      const result = yield* profiles.profileOf(existing[0]!);
      if (!result.ok) {
        return refusedUnknownProfile(result.stamped.stamp, {
          indexedKey: item.indexedKey,
          path: existing[0]!.path,
        }) satisfies CreateNoteResult as CreateNoteResult;
      }
      if (result.profile.selector !== requestedProfile) {
        return refusedProfileConflict(item.indexedKey, existing[0]!, {
          existingProfile: result.profile.selector,
          requestedProfile,
        }) as CreateNoteResult;
      }
    }
    return refusedCreate(item.indexedKey, existing) as CreateNoteResult;
  }
  const document = yield* resolveProfileDocument(profile);
  if (document === null) {
    return refusedMissingDocument(profile.document!, {
      indexedKey: item.indexedKey,
    }) satisfies CreateNoteResult as CreateNoteResult;
  }
  // One Snapshot across the render and the vault write: every read of this
  // create sees one database state. A batch hands in its own.
  return yield* withReads(options.reads, (reads) =>
    Effect.gen(function* () {
      const source = yield* readNoteSource(reads, item.itemID, {
        username: options.username,
      });
      if (!source)
        return yield* new ItemNotFound({
          indexedKey: item.indexedKey,
          message: `Zotero item not found: ${item.indexedKey}`,
        });
      // The filename renders from the Snapshot's Item, as the body does.
      const { itemTags, itemCollections } = itemFacets(source);
      const { path } =
        options.preparedPath ??
        (yield* resolveNotePath(source.item, {
          itemTags,
          itemCollections,
          settings: profile.settings,
          document,
        }));
      const vault = yield* Vault;
      return yield* writeNewNote(ctx, item, {
        reads,
        source,
        path,
        settings: profile.settings,
        profile,
        document,
        onFileCreated: options.onFileCreated,
        reportExcerpts: options.reportExcerpts,
        outcomes: options.outcomes,
        createFile: (content) =>
          Effect.andThen(
            ensureVaultParentFolder(path),
            vault.create(path, content),
          ),
      });
    }),
  );
});

/**
 * Prepare and render once; the supplied create boundary writes these composed
 * bytes in one create.
 */
const writeNewNote = Effect.fnUntraced(function* <E>(
  ctx: NoteWriteContext,
  item: Item,
  options: {
    reads: ZoteroReadsApi;
    /** The item's bundle, read under the same Snapshot. */
    source: NoteSource;
    path: string;
    settings: Readonly<Settings>;
    profile: ResolvedProfile;
    document: ResolvedLiteratureNoteTemplate | undefined;
    onFileCreated?: (file: TFile) => Effect.Effect<void>;
    createFile: (content: string) => Effect.Effect<TFile, E, Vault>;
    reportExcerpts?: (summary: ExcerptSummary) => void;
    /** The batch's retained outcomes, or omitted for this note's own scope. */
    outcomes?: ExcerptOutcomeScope;
  },
) {
  const { path, settings } = options;
  yield* ensureVaultParentFolder(path);
  // One created note is one initiating batch: its excerpts share this
  // retention until the note settles.
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const outcomes = yield* outcomeScope(options.outcomes);
      const excerptImages = yield* (yield* ExcerptPreparation).forNote({
        reads: options.reads,
        notePath: path,
        settings,
        outcomes,
      });
      const attachmentImport = yield* (yield* AttachmentImport).prepare(path);
      const resolvers = yield* noteResolvers({
        attachmentImport,
        settings,
        sourcePath: path,
        excerptImages,
      });
      const context = buildNoteContextFromSource(options.source, resolvers);
      yield* excerptImages.prepare;
      const template = yield* syncTemplate;
      const now = toInstant(yield* DateTime.now);
      const composed = yield* Effect.try({
        try: () =>
          composeLiteratureNote(
            { template, events: composeEvents(ctx) },
            {
              context,
              itemKey: item.indexedKey,
              profile: options.profile,
              document: options.document,
              now,
            },
          ),
        catch: (cause) => aborted(path, cause),
      });
      if (composed.outcome === "refused") {
        const refused: CreateNoteResult = {
          outcome: "refused",
          diagnostic: frontmatterRefusal(composed.failures, {
            itemKey: item.indexedKey,
            diagnosticContext: { indexedKey: item.indexedKey },
          }),
        };
        return refused;
      }

      // The write and its attachment copies run to the end: an interrupt
      // never leaves a written note that names attachments not yet copied.
      const file = yield* Effect.uninterruptible(
        Effect.gen(function* () {
          const file = yield* options.createFile(composed.content);
          if (options.onFileCreated) yield* options.onFileCreated(file);
          yield* flushNoteAttachments(ctx, {
            attachmentImport,
            excerptImages,
            reportExcerpts: options.reportExcerpts,
          });
          return file;
        }),
      );
      yield* Effect.logDebug("Created literature note").pipe(
        Effect.annotateLogs({ path: file.path, itemKey: item.indexedKey }),
        logged,
      );
      const created: CreateNoteResult = { outcome: "created", file };
      return created;
    }),
  );
});

/** What an update writes, and the batch above it when there is one. */
export interface UpdateNoteOptions {
  indexedKey: string;
  scope?: UpdateScope;
  profile?: ProfileSelector;
  /**
   * Recheck a caller-owned editing session just before the note's one write;
   * throwing leaves the note untouched. The write itself checks the note's
   * Zotero key and refuses a note that no longer carries `indexedKey` with
   * `literature-note-key-changed`.
   */
  beforeWrite?: () => void;
  /**
   * The initiating batch's retained outcomes. Omitted, this update opens its
   * own scope for the note it writes, then releases it once the note settles.
   */
  outcomes?: ExcerptOutcomeScope;
}

export const updateNote = Effect.fnUntraced(function* (
  ctx: NoteWriteContext,
  file: TFile,
  options: UpdateNoteOptions,
) {
  const { indexedKey, scope = "full" } = options;
  const profiles = yield* Profile;
  // Settle readiness and prepare the attachment handle before pinning the
  // Snapshot, so the lease spans only the DB reads and the vault writes — not
  // the warm-up waits.
  yield* (yield* NoteIndex).whenIndexed;
  const settings = yield* (yield* PluginSettings).current;
  const existing = yield* profiles.profileOf(file);
  const existingSelector = noteProfileSelector(existing);
  if (options.profile !== undefined && existingSelector !== undefined) {
    const requestedProfile = options.profile;
    if (!(yield* profiles.resolveProfile(requestedProfile))) {
      return refusedUpdateProfile(requestedProfile, file.path);
    }
    if (requestedProfile !== existingSelector) {
      return refusedUpdateProfileConflict(indexedKey, file.path, {
        existingProfile: existingSelector,
        requestedProfile,
      });
    }
  }
  if (!existing.ok) {
    return refusedUpdateProfile(existing.stamped.stamp, file.path);
  }
  const profile = existing.profile;
  if (conversionRequired(settings, profile.selector)) {
    return refusedUpdateTemplateConversion(profile.selector, file.path);
  }
  const document = yield* resolveProfileDocument(profile);
  if (document === null) {
    return refusedUpdateMissingDocument(profile.document!, file.path);
  }
  const attachmentImport = yield* (yield* AttachmentImport).prepare(file.path);
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const reads = yield* (yield* ZoteroReads).snapshot;
      // One initiating batch: this note's excerpts share one retention until
      // the note settles.
      const outcomes = yield* outcomeScope(options.outcomes);
      const { context, excerptImages } = yield* contextForIndexedKey(
        ctx,
        indexedKey,
        {
          reads,
          attachmentImport,
          sourcePath: file.path,
          settings: profile.settings,
          previousNote: scope === "full" ? file : undefined,
          outcomes,
        },
      );
      // Run inside the retention's scope, so the retention outlives the
      // note's excerpt resolution.
      return yield* applyManagedUpdate(ctx, file, {
        context,
        attachmentImport,
        itemKey: indexedKey,
        scope,
        profile,
        document,
        beforeWrite: options.beforeWrite,
        excerptImages,
      });
    }),
  );
});

const NO_KEYS: ReadonlySet<string> = new Set();

/**
 * The keys of a Literature Note that its next update replaces: those its
 * own Profile manages with the replace strategy, a Spread Entry's as it
 * evaluates for the note's Item now. A note the metadata cache has not
 * parsed yet, as one just created, is read once it does. None where the
 * update would refuse, or the Profile, its template or the Item cannot be
 * read now, so that a key stays editable rather than locked on a passing
 * fault. An interrupt passes on.
 */
export const replacedKeys = (ctx: NoteWriteContext, file: TFile) =>
  readReplacedKeys(ctx, file).pipe(
    recover(
      (cause) =>
        Effect.logDebug(
          "Could not read the keys a note's Profile replaces",
        ).pipe(
          Effect.annotateLogs({ path: file.path, error: Cause.squash(cause) }),
          logged,
        ),
      Effect.succeed(NO_KEYS),
    ),
  );

const readReplacedKeys = Effect.fnUntraced(function* (
  ctx: NoteWriteContext,
  file: TFile,
) {
  const settings = yield* (yield* PluginSettings).current;
  const cache = yield* parsedCache(file);
  const resolved = yield* (yield* Profile).profileOf(file);
  if (!resolved.ok) return NO_KEYS;
  const { profile } = resolved;
  if (conversionRequired(settings, profile.selector)) return NO_KEYS;
  const document = yield* resolveProfileDocument(profile);
  if (document === null) return NO_KEYS;
  if (document === undefined) {
    const fields = yield* (yield* Template).frontmatterFields;
    return new Set(
      fields.flatMap(({ key, merge }) => (merge === "replace" ? [key] : [])),
    ) as ReadonlySet<string>;
  }
  const entries = document.frontmatter?.compiled ?? [];
  const keys = new Set(
    entries.flatMap(({ key, merge }) =>
      key !== undefined && merge === "replace" ? [key] : [],
    ),
  );
  const spreads = entries.filter(
    ({ key, merge }) => key === undefined && merge === "replace",
  );
  const indexedKey = itemKeyFromFrontmatter(cache);
  if (spreads.length === 0 || !indexedKey) return keys as ReadonlySet<string>;
  // A Spread Entry names its keys as it runs for the Item, as the update
  // runs it; nothing it queues is imported.
  const attachmentImport = yield* (yield* AttachmentImport).prepare(file.path);
  yield* Effect.scoped(
    Effect.gen(function* () {
      const reads = yield* (yield* ZoteroReads).snapshot;
      const { context } = yield* contextForIndexedKey(ctx, indexedKey, {
        reads,
        attachmentImport,
        sourcePath: file.path,
        settings: profile.settings,
      });
      const evaluation = evalManagedFrontmatterEntries(
        spreads,
        context,
        toInstant(yield* DateTime.now),
      );
      for (const { key } of evaluation.values) keys.add(key);
    }),
  ).pipe(Effect.ensuring(attachmentImport.discard));
  return keys as ReadonlySet<string>;
});

/**
 * The metadata of `file`, once the metadata cache has parsed it. The wait
 * listens before it reads the cache, so a parse that lands between the two
 * still answers.
 */
const parsedCache = Effect.fnUntraced(function* (file: TFile) {
  const metadata = yield* MetadataCache;
  const parsed = yield* filterTag(metadata.changes, "changed").pipe(
    Stream.filter((event) => event.file.path === file.path),
    Stream.runHead,
    Effect.forkChild({ startImmediately: true }),
  );
  const cache = yield* metadata.fileCache(file);
  if (cache !== null) {
    yield* Fiber.interrupt(parsed);
    return cache;
  }
  const event = yield* Fiber.join(parsed);
  // The changes end only when the cache closes with the plugin.
  if (Option.isNone(event)) return yield* Effect.interrupt;
  return event.value.cache;
});

export const switchNoteProfile = Effect.fnUntraced(function* (
  file: TFile,
  options: {
    profile: ProfileSelector;
    importedNotes?: readonly TFile[];
    move?: boolean;
  },
) {
  const settings = yield* (yield* PluginSettings).current;
  const profiles = yield* Profile;
  const fileManager = yield* FileManager;
  const selector = options.profile;
  const profile = yield* profiles.resolveProfile(selector);
  if (!profile) return refusedUpdateProfile(selector, file.path);
  if (conversionRequired(settings, selector)) {
    return refusedUpdateTemplateConversion(selector, file.path);
  }
  const document = yield* resolveProfileDocument(profile);
  if (document === null) {
    return refusedUpdateMissingDocument(profile.document!, file.path);
  }
  const previousPath = file.path;
  const imported =
    noteKeyFromFrontmatter(yield* (yield* MetadataCache).fileCache(file)) !==
    null;
  const targetPath = relocatedNotePath(file, {
    from: relocationSource(yield* profiles.profileOf(file)),
    to: profile,
    imported,
  });
  const move = options.move === true && targetPath !== previousPath;
  // The move, the stamps and their rollback run to the end, so an interrupt
  // never leaves a moved note without its stamp.
  yield* Effect.uninterruptible(
    Effect.gen(function* () {
      if (move) {
        yield* ensureVaultParentFolder(targetPath);
        yield* fileManager.renameFile(file, targetPath);
      }
      yield* stampNoteFamily(
        [file, ...(options.importedNotes ?? [])],
        profile.stamp,
      ).pipe(
        Effect.catch((error) =>
          move
            ? fileManager.renameFile(file, previousPath).pipe(
                Effect.mapError(
                  (rollbackError) =>
                    new ProfileSwitchRollbackFailed({
                      message: "Profile switch and folder move rollback failed",
                      cause: new AggregateError([error, rollbackError]),
                    }),
                ),
                Effect.andThen(Effect.fail(error)),
              )
            : Effect.fail(error),
        ),
      );
    }),
  );
  yield* Effect.logDebug(
    "Switched Literature Note Profile for the next update",
  ).pipe(
    Effect.annotateLogs({
      path: file.path,
      selector,
      importedNotes: options.importedNotes?.length ?? 0,
      moved: move,
    }),
    logged,
  );
  return NO_BODY_UPDATE;
});

/**
 * Stamp each of `files` with `stamp`. A failure puts back the stamps already
 * written, the last first, then fails with what failed.
 */
const stampNoteFamily = Effect.fnUntraced(function* (
  files: readonly TFile[],
  stamp: string | undefined,
) {
  const metadata = yield* MetadataCache;
  const previous = yield* Effect.forEach(files, (file) =>
    Effect.map(
      metadata.fileCache(file),
      (cache) => [file, profileStampOf(cache)?.stamp] as const,
    ),
  );
  yield* Effect.forEach(
    previous,
    ([file], index) =>
      stampNoteProfile(file, stamp).pipe(
        Effect.mapError((error) => ({ error, index })),
      ),
    { discard: true },
  ).pipe(
    Effect.catch(({ error, index }) =>
      Effect.gen(function* () {
        // The failed note too: its write may have landed before it failed.
        const rollbacks = yield* Effect.forEach(
          previous.slice(0, index + 1).toReversed(),
          ([file, previousStamp]) =>
            Effect.result(stampNoteProfile(file, previousStamp)),
        );
        const rollbackErrors = rollbacks.flatMap((rollback) =>
          Result.isFailure(rollback) ? [rollback.failure] : [],
        );
        if (rollbackErrors.length > 0)
          return yield* new ProfileSwitchRollbackFailed({
            message: "Note Profile switch and rollback failed",
            cause: new AggregateError([error, ...rollbackErrors]),
          });
        return yield* Effect.fail(error);
      }),
    ),
  );
});

/** Write one note's Profile stamp; `undefined` unstamps it as the default. */
const stampNoteProfile = (file: TFile, stamp: string | undefined) =>
  rewriteLiveText(file, (text) => {
    const fm = parseFrontMatter(text);
    if (stamp === undefined) delete fm[FIELD_LITERATURE_NOTE_PROFILE];
    else fm[FIELD_LITERATURE_NOTE_PROFILE] = stamp;
    return spliceFrontMatter(text, fm);
  });

/**
 * Rewrite `file`'s live text with `fn`, as `processLiveText` does. A throw
 * from `fn` leaves the note as it was and fails as {@link aborted} gives it.
 */
const rewriteLiveText = (file: TFile, fn: (text: string) => string) =>
  processLiveText(file, fn).pipe(
    Effect.catchTag("LiveTextRewriteFailed", ({ path, cause }) =>
      Effect.fail(aborted(path, cause)),
    ),
  );

/**
 * Update an existing note from an already-fetched `item`. The batch runner
 * calls this to reuse the item it classified, skipping the per-item
 * resolution {@link updateNote} does via `indexedKey` (re-deriving the
 * library and re-querying the item).
 *
 * Assumes the caller has gated database, note-index, and template readiness;
 * the batch runner does so once for the whole run, so unlike {@link updateNote}
 * (via {@link contextForIndexedKey}) this does not wait for them itself.
 */
export const writeNoteUpdate = Effect.fnUntraced(function* (
  ctx: NoteWriteContext,
  file: TFile,
  options: WriteNoteUpdateOptions,
) {
  const profiles = yield* Profile;
  const existing = yield* profiles.profileOf(file);
  const existingSelector = noteProfileSelector(existing);
  if (options.profile !== undefined && existingSelector !== undefined) {
    const requestedProfile = options.profile;
    if (!(yield* profiles.resolveProfile(requestedProfile))) {
      return refusedUpdateProfile(requestedProfile, file.path);
    }
    if (requestedProfile !== existingSelector) {
      return refusedUpdateProfileConflict(options.item.indexedKey, file.path, {
        existingProfile: existingSelector,
        requestedProfile,
      });
    }
  }
  if (!existing.ok) {
    return refusedUpdateProfile(existing.stamped.stamp, file.path);
  }
  const profile = existing.profile;
  if (conversionRequired(options.settings, profile.selector)) {
    return refusedUpdateTemplateConversion(profile.selector, file.path);
  }
  const document = yield* resolveProfileDocument(profile);
  if (document === null) {
    return refusedUpdateMissingDocument(profile.document!, file.path);
  }
  const attachmentImport = yield* (yield* AttachmentImport).prepare(file.path);
  // Without a batch above it, this update is its own initiating batch: its
  // excerpts share this retention.
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const outcomes = yield* outcomeScope(options.outcomes);
      const source = yield* readNoteSource(options.reads, options.item.itemID, {
        username: options.username,
      });
      if (!source)
        return yield* new ItemNotFound({
          indexedKey: options.item.indexedKey,
          message: `Zotero item not found: ${options.item.indexedKey}`,
        });
      const excerptImages =
        options.scope !== "metadata"
          ? yield* (yield* ExcerptPreparation).forNote({
              reads: options.reads,
              notePath: file.path,
              settings: profile.settings,
              previousNote: file,
              outcomes,
            })
          : undefined;
      const resolvers = yield* noteResolvers({
        attachmentImport,
        settings: profile.settings,
        sourcePath: file.path,
        excerptImages,
      });
      const context = buildNoteContextFromSource(source, resolvers);
      // Run inside the scope, so the retention outlives the note's excerpt
      // resolution.
      return yield* applyManagedUpdate(ctx, file, {
        context,
        attachmentImport,
        itemKey: options.item.indexedKey,
        reportExcerpts: options.reportExcerpts,
        scope: options.scope ?? "full",
        profile,
        document,
        excerptImages,
      });
    }),
  );
});

/** Compose a managed update: prepare the frontmatter, render the managed body
 *  region for the `full` scope, then write both in one {@link rewriteNote}. A
 *  document field refusal returns before the write, and the body render —
 *  where a call to a Shared Partial the vault holds no document for raises —
 *  runs while the note is still untouched, so a refusal leaves both the
 *  Properties block and the body as authored. Shared by {@link updateNote} and
 *  {@link writeNoteUpdate}; the caller supplies the already-built context and
 *  its prepared `attachmentImport`. */
const applyManagedUpdate = Effect.fnUntraced(function* (
  ctx: NoteWriteContext,
  file: TFile,
  input: {
    context: NoteTemplateContext;
    attachmentImport: Pick<AttachmentImportBatch, "flush">;
    itemKey: string;
    scope: UpdateScope;
    profile: ResolvedProfile;
    document: ResolvedLiteratureNoteTemplate | undefined;
    beforeWrite?: () => void;
    excerptImages?: PreparedExcerpts;
    reportExcerpts?: (summary: ExcerptSummary) => void;
  },
) {
  const { context, itemKey, scope, profile, document, beforeWrite } = input;
  const prepared = yield* prepareFrontmatter({
    context,
    itemKey,
    document,
    diagnosticContext: { path: file.path },
  });
  if ("diagnostic" in prepared)
    return { ...NO_BODY_UPDATE, diagnostic: prepared.diagnostic };
  const { excerptImages } = input;
  if (excerptImages) yield* excerptImages.prepare;
  const noManagedBlock =
    scope === "full" && document !== undefined && !document.hasManagedBlock;
  const template = yield* syncTemplate;
  // The render waits until the note's live text has a region to receive it.
  const renderRegion =
    scope === "full" && !noManagedBlock
      ? () =>
          document
            ? document.renderForUpdate(context)!
            : template.renderManagedContent(context)
      : undefined;
  let replaced = false;
  let duplicateCount = 0;
  // The write and its attachment copies run to the end: an interrupt never
  // leaves a written note that names attachments not yet copied.
  const refused = yield* Effect.uninterruptible(
    Effect.gen(function* () {
      const refused = yield* rewriteNote(ctx, file, {
        context,
        itemKey,
        profile,
        prepared,
        beforeWrite,
        body: (body) => {
          if (renderRegion === undefined) return body;
          const result = replaceManagedRegion(body, renderRegion);
          replaced = result.replaced;
          duplicateCount = result.duplicateCount;
          return result.content;
        },
      });
      if (!refused) yield* flushNoteAttachments(ctx, input);
      return refused;
    }),
  );
  if (refused) return { ...NO_BODY_UPDATE, diagnostic: refused };
  if (duplicateCount > 0) {
    yield* Effect.logWarning(
      "Literature note has duplicate managed regions",
    ).pipe(
      Effect.annotateLogs({
        path: file.path,
        itemKey,
        count: duplicateCount + 1,
      }),
      logged,
    );
  }

  yield* Effect.logDebug("Updated literature note").pipe(
    Effect.annotateLogs({
      path: file.path,
      itemKey,
      scope,
      bodyUpdated: replaced,
    }),
    logged,
  );
  const result: UpdateResult = {
    bodyUpdated: replaced,
    duplicateRegionCount: duplicateCount,
    ...(noManagedBlock && { noManagedBlock: true }),
  };
  return result;
});

/** What an overwrite writes, and the batch above it when there is one. */
interface OverwriteNoteOptions {
  /** The Indexed Key of the Zotero item the note is stamped for. */
  indexedKey: string;
  /**
   * The initiating batch's retained outcomes. Omitted, this overwrite opens its
   * own scope for the note it writes, then releases it once the note settles.
   */
  outcomes?: ExcerptOutcomeScope;
}

export const overwriteNote = Effect.fnUntraced(function* (
  ctx: NoteWriteContext,
  file: TFile,
  options: OverwriteNoteOptions,
) {
  const { indexedKey } = options;
  // Settle readiness and prepare the attachment handle before pinning the
  // Snapshot, so the lease spans only the DB reads and the vault writes — not
  // the warm-up waits.
  yield* (yield* NoteIndex).whenIndexed;
  const settings = yield* (yield* PluginSettings).current;
  const result = yield* (yield* Profile).profileOf(file);
  if (!result.ok) return refusedUpdateProfile(result.stamped.stamp, file.path);
  const profile = result.profile;
  if (conversionRequired(settings, profile.selector)) {
    return refusedUpdateTemplateConversion(profile.selector, file.path);
  }
  const document = yield* resolveProfileDocument(profile);
  if (document === null) {
    return refusedUpdateMissingDocument(profile.document!, file.path);
  }
  const attachmentImport = yield* (yield* AttachmentImport).prepare(file.path);
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const reads = yield* (yield* ZoteroReads).snapshot;
      // One initiating batch: this note's excerpts share one retention until
      // the note settles.
      const outcomes = yield* outcomeScope(options.outcomes);
      const { context, excerptImages } = yield* contextForIndexedKey(
        ctx,
        indexedKey,
        {
          reads,
          attachmentImport,
          sourcePath: file.path,
          settings: profile.settings,
          previousNote: file,
          outcomes,
        },
      );
      const prepared = yield* prepareFrontmatter({
        context,
        itemKey: indexedKey,
        document,
        diagnosticContext: { path: file.path },
      });
      if ("diagnostic" in prepared)
        return { ...NO_BODY_UPDATE, diagnostic: prepared.diagnostic };
      if (excerptImages) yield* excerptImages.prepare;
      // The body renders before either write, so a render that raises — a call
      // to a Shared Partial the vault holds no document for — leaves the note
      // whole.
      const body = document
        ? yield* renderFor(file.path, () => document.renderForCreate(context))
        : yield* (yield* Template).render("note", context);
      // The write and its attachment copies run to the end: an interrupt
      // never leaves a written note that names attachments not yet copied.
      const refused = yield* Effect.uninterruptible(
        Effect.gen(function* () {
          const refused = yield* rewriteNote(ctx, file, {
            context,
            itemKey: indexedKey,
            profile,
            prepared,
            body: () => body,
          });
          if (!refused)
            yield* flushNoteAttachments(ctx, {
              attachmentImport,
              excerptImages,
            });
          return refused;
        }),
      );
      if (refused) return { ...NO_BODY_UPDATE, diagnostic: refused };

      yield* Effect.logInfo("Overwrote literature note").pipe(
        Effect.annotateLogs({ path: file.path, itemKey: indexedKey }),
        logged,
      );
      const overwritten: UpdateResult = {
        bodyUpdated: true,
        duplicateRegionCount: 0,
      };
      return overwritten;
    }),
  );
});

/**
 * Commit the note's attachment copies, then report its excerpt outcomes: to
 * the batch's collector, or as the Note Feature's own event.
 */
const flushNoteAttachments = (
  ctx: NoteWriteContext,
  input: {
    attachmentImport: Pick<AttachmentImportBatch, "flush">;
    excerptImages?: PreparedExcerpts;
    reportExcerpts?: (summary: ExcerptSummary) => void;
  },
) =>
  Effect.suspend(() => {
    const summary = input.excerptImages?.summary();
    const report = summary && nonEmptySummary(summary);
    return input.attachmentImport.flush.pipe(
      Effect.ensuring(
        Effect.sync(() => {
          if (!report) return;
          if (input.reportExcerpts) input.reportExcerpts(report);
          else ctx.emit({ _tag: "excerpt-images-reported", payload: report });
        }),
      ),
    );
  });

/**
 * Assumes the caller has settled note-index and template readiness (and
 * pinned a Snapshot); {@link updateNote} and {@link overwriteNote} do so
 * before opening it.
 */
const contextForIndexedKey = Effect.fnUntraced(function* (
  ctx: NoteWriteContext,
  indexedKey: string,
  options: {
    /** Bound to the operation's Snapshot. */
    reads: ZoteroReadsApi;
    attachmentImport: Pick<AttachmentImportBatch, "decide" | "resolveLink">;
    sourcePath: string;
    settings: Readonly<Settings>;
    previousNote?: TFile;
    /** The initiating batch's retained outcomes. */
    outcomes?: ExcerptOutcomeScope;
  },
) {
  const { reads, sourcePath, settings } = options;
  const item = yield* readItem(reads, indexedKey);
  const source = item && (yield* readNoteSource(reads, item.itemID));
  if (!source)
    return yield* new ItemNotFound({
      indexedKey,
      message: `Zotero item not found: ${indexedKey}`,
    });
  const excerptImages = options.previousNote
    ? yield* (yield* ExcerptPreparation).forNote({
        reads,
        notePath: sourcePath,
        settings,
        previousNote: options.previousNote,
        outcomes: options.outcomes,
      })
    : undefined;
  const resolvers = yield* noteResolvers({
    attachmentImport: options.attachmentImport,
    settings,
    sourcePath,
    excerptImages,
  });
  const context = buildNoteContextFromSource(source, resolvers);
  return { context, excerptImages };
});

/**
 * The {@link NoteSource} of an item, or `null` for an unknown item. An omitted
 * `username` reads the signed-in account.
 */
const readNoteSource = (
  reads: ZoteroReadsApi,
  itemID: number,
  options: { username?: string | null } = {},
) =>
  reads.NoteSource({
    itemID,
    ...(options.username !== undefined && { username: options.username }),
  });

/**
 * Rewrite a Literature Note's live text in one `processLiveText`: apply the
 * prepared Managed Frontmatter with `spliceFrontMatter`, and transform the
 * body, so both land together or not at all. The note's Zotero key and
 * Profile stamp are read from the text this write replaces: the metadata cache
 * that chose the Profile lags behind a recent write or an unsaved edit.
 *
 * @returns the refusal when the note no longer carries `itemKey`, or its stamp
 *   no longer names the Profile the update rendered under; the note is left
 *   untouched then.
 */
const rewriteNote = Effect.fnUntraced(function* (
  ctx: NoteWriteContext,
  file: TFile,
  input: ComposeFrontmatterInput & {
    /** The Profile the update rendered under. */
    profile: Pick<ResolvedProfile, "selector">;
    /** The caller's own session check, run just before the write. */
    beforeWrite?: () => void;
    body: (body: string) => string;
  },
) {
  const template = yield* syncTemplate;
  let changed: "key" | "profile" | undefined;
  yield* rewriteLiveText(file, (content) => {
    const fm = parseFrontMatter(content);
    changed = undefined;
    if (fm[FIELD_ZOTERO_KEY] !== input.itemKey) changed = "key";
    else if (stampedSelector(fm) !== input.profile.selector)
      changed = "profile";
    if (changed) return content;
    input.beforeWrite?.();
    applyComposedFrontmatter(
      { template, events: composeEvents(ctx) },
      fm,
      input,
    );
    // The Properties block and the body are rewritten apart, then joined.
    const { contentStart } = getFrontMatterInfo(content);
    return (
      spliceFrontMatter(content.slice(0, contentStart), fm) +
      input.body(content.slice(contentStart))
    );
  });
  if (changed === "key") {
    const diagnostic: NoteKeyChangedDiagnostic = {
      code: "literature-note-key-changed",
      hint: "The note's Zotero key changed while the update ran. Run the update again from the note.",
      indexedKey: input.itemKey,
      path: file.path,
    };
    return diagnostic;
  }
  if (changed === "profile") {
    const diagnostic: NoteProfileChangedDiagnostic = {
      code: "literature-note-profile-changed",
      hint: "The note's Profile stamp changed while the update ran. Run the update again from the note.",
      indexedKey: input.itemKey,
      path: file.path,
    };
    return diagnostic;
  }
  return undefined;
});

/** The Profile a note's Properties stamp: `default` when they carry no stamp. */
function stampedSelector(
  fm: Record<string, unknown>,
): ProfileSelector | undefined {
  const stamped = parseProfileStamp(fm[FIELD_LITERATURE_NOTE_PROFILE]);
  return stamped === undefined ? DEFAULT_PROFILE : stamped.id;
}

const prepareFrontmatter = Effect.fnUntraced(function* (input: {
  context: NoteTemplateContext;
  itemKey: string;
  document: ResolvedLiteratureNoteTemplate | undefined;
  diagnosticContext: { path?: string; indexedKey?: string };
}) {
  const result = prepareManagedFrontmatter(
    input.document?.frontmatter,
    input.context,
    toInstant(yield* DateTime.now),
  );
  if ("prepared" in result) return result.prepared;
  return { diagnostic: frontmatterRefusal(result.failures, input) };
});

/** A type guard: when conversion is pending, a non-default selector is a real Profile ID. */
function conversionRequired(
  settings: Readonly<Settings>,
  selector: ProfileSelector,
): selector is ProfileId {
  return (
    settings["note.template-conversion-pending"] && selector !== DEFAULT_PROFILE
  );
}

export type CreateNoteError = Effect.Error<ReturnType<typeof createNote>>;
export type UpdateNoteError = Effect.Error<ReturnType<typeof updateNote>>;
export type SwitchNoteProfileError = Effect.Error<
  ReturnType<typeof switchNoteProfile>
>;
export type OverwriteNoteError = Effect.Error<ReturnType<typeof overwriteNote>>;
export type WriteNoteUpdateError = Effect.Error<
  ReturnType<typeof writeNoteUpdate>
>;
