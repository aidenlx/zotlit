import { stringifyYaml } from "obsidian";
import type { TFile } from "obsidian";

import {
  citekeysToCiteTemplateData,
  CollectionCache,
  fetchAnnotationsTemplateData,
  fetchNoteContext,
  getAnnotationsByItemId,
  getChildNotesByParentIDs,
  getZoteroIdentity,
  getItemsByKey,
  resolveIndexedKeyLibrary,
  resolveItemTags,
} from "@zotlit/db";
import type {
  CiteRef,
  GroupIDMemo,
  Item,
  NoteTemplateContext,
  TagMemo,
} from "@zotlit/db";
import type { NodeDatabaseClient } from "@zotlit/db/client/node";
import type { UpdateScope } from "@zotlit/protocol";
import { createNanoEvents } from "@zotlit/shared/nanoevents";
import type { Emitter } from "@zotlit/shared/nanoevents";
import { stringifyFrontmatterInOrder } from "@zotlit/templates/frontmatter";
import { replaceManagedRegion } from "@zotlit/templates/obsidian";

import {
  annotationCitation,
  buildAnnotationResolvers,
  renderAnnotations,
} from "@/lib/annotation-render";
import {
  FIELD_CITATION_STYLE,
  FIELD_LITERATURE_NOTE_PROFILE,
} from "@/lib/constants";
import { ensureParentFolder } from "@/lib/ensure-folder";
import * as m from "@/lib/i18n/generated/messages";
import { inlineCitation } from "@/lib/inline-citation";
import { getLogger } from "@/lib/log";
import { isFileExistsError } from "@/lib/vault-errors";
import type { AttachmentImport } from "@/services/attachment-import/service";
import type { NoteImport } from "@/services/note-import/service";
import { itemKeyFromFrontmatter } from "@/services/note-index/service";
import type { Settings } from "@/services/settings/schema";
import { bindLiteratureNoteProfile } from "@/services/settings/service";
import type { ProfileBindingSettings } from "@/services/settings/service";
import type { ResolvedLiteratureNoteTemplate } from "@/services/template/service";

import {
  buildNoteResolvers,
  fetchItemCollections,
  resolveNotePath,
} from "./context";
import type { NoteFeatureDeps, SyncRenderDeps } from "./context";
import {
  applyDocumentManagedFrontmatter,
  applyManagedFrontmatter,
  prepareManagedFrontmatter,
} from "./frontmatter";
import type { PreparedManagedFrontmatter } from "./frontmatter";

const logger = getLogger("note-feature");

// Tolerates CRLF: Obsidian's processFrontMatter preserves the note's
// original line-ending bytes in the `---` delimiters, so a CRLF-authored
// note must still match here or its frontmatter prefix is dropped.
const FRONTMATTER_BLOCK = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n+|$)/;
const MAX_UNINDEXED_CREATES = 256;

export interface UpdateResult {
  bodyUpdated: boolean;
  duplicateRegionCount: number;
  noManagedBlock?: true;
  diagnostic?: NoteOperationDiagnostic;
}

export interface ExistingNoteDiagnostic {
  code: "literature-note-exists" | "duplicate-literature-notes";
  hint: string;
  indexedKey: string;
  paths: [string, ...string[]];
}

export interface UnknownNoteProfileDiagnostic {
  code: "unknown-literature-note-profile";
  hint: string;
  profileId: string;
  path?: string;
  indexedKey?: string;
}

export interface NoteProfileConflictDiagnostic {
  code: "literature-note-profile-conflict";
  hint: string;
  indexedKey: string;
  path: string;
  existingProfileId: string | null;
  requestedProfileId: string | null;
}

export interface MissingLiteratureNoteTemplateDiagnostic {
  code: "missing-literature-note-template";
  hint: string;
  document: string;
  path?: string;
  indexedKey?: string;
}

export interface LiteratureNoteTemplateConversionRequiredDiagnostic {
  code: "literature-note-template-conversion-required";
  hint: string;
  profileId: string;
  path?: string;
  indexedKey?: string;
}

export interface ManagedFrontmatterFailureDiagnostic {
  field: string;
  message: string;
  hint: string;
}

export interface ManagedFrontmatterRefusalDiagnostic {
  code: "managed-frontmatter-refused";
  hint: string;
  failures: [
    ManagedFrontmatterFailureDiagnostic,
    ...ManagedFrontmatterFailureDiagnostic[],
  ];
  path?: string;
  indexedKey?: string;
}

export type NoteOperationDiagnostic =
  | UnknownNoteProfileDiagnostic
  | NoteProfileConflictDiagnostic
  | MissingLiteratureNoteTemplateDiagnostic
  | LiteratureNoteTemplateConversionRequiredDiagnostic
  | ManagedFrontmatterRefusalDiagnostic;

export type CreateNoteDiagnostic =
  | ExistingNoteDiagnostic
  | NoteOperationDiagnostic;

export type CreateNoteResult =
  | { outcome: "created"; file: TFile }
  | { outcome: "refused"; diagnostic: CreateNoteDiagnostic };

// `UpdateScope` is the wire enum obsidian decodes; re-export it so note-feature
// consumers keep a stable import path without redeclaring the union.
export type { UpdateScope };

/** Result for an update that intentionally leaves the body region untouched. */
const NO_BODY_UPDATE: UpdateResult = {
  bodyUpdated: false,
  duplicateRegionCount: 0,
};

/**
 * Concurrent/batch creation can land a sibling between resolve and write. Each
 * retry forces a fresh `suffix()`, so even one almost always frees the name;
 * the bound just stops an unbounded loop.
 */
const MAX_CREATE_RETRIES = 5;

/** Per-batch memos threaded through a multi-item create run. */
export interface CreateNoteOptions {
  collectionCache?: CollectionCache;
  tagMemo?: TagMemo;
  groupIdMemo?: GroupIDMemo;
  /**
   * The batch supplies the once-resolved account username; a single-item create
   * resolves it from its own lease when omitted.
   */
  username?: string | null;
  /** `null` explicitly selects the built-in default Profile. */
  profileId?: string | null;
}

interface CreateNoteInternalOptions extends CreateNoteOptions {
  onFileCreated?: (file: TFile) => void;
}

/**
 * Batch-threaded write: the caller owns the run-wide lease and passes its pinned
 * `client` plus the run's shared memos, so no per-item lease re-acquisition.
 */
export interface WriteNoteUpdateOptions {
  client: NodeDatabaseClient;
  item: Item;
  tagMemo: TagMemo;
  collectionCache: CollectionCache;
  settings: Readonly<Settings>;
  scope?: UpdateScope;
  groupIdMemo?: GroupIDMemo;
  /** Once-resolved account username for the batch. */
  username: string | null;
  /** Headless explicit Profile. A different stamp is refused. */
  profileId?: string | null;
}

/** Events the bound note feature emits; a UI subscriber owns any rendering. */
export interface NoteFeatureEvents {
  /**
   * A legacy settings-held frontmatter expression failed during a write; the
   * write completed with those keys skipped.
   */
  "frontmatter-eval-failed": (payload: {
    itemKey: string;
    fields: string[];
  }) => void;
}

/** Deps plus the feature's emitter, threaded through the internal operations. */
type OpsContext = NoteFeatureDeps & { events: Emitter<NoteFeatureEvents> };

/**
 * The bound note-feature operations returned by {@link createNoteFeature}.
 * Consumers hold this object; the collaborators stay behind the seam.
 */
export interface NoteFeature {
  /**
   * Settles when templates and the note index are usable. Single-item methods
   * gate internally; batch runners await this once per run before a
   * {@link NoteFeature.writeNoteUpdate} loop (which assumes readiness).
   */
  ready: Promise<void>;
  /** @see createNote */
  createNote(
    item: Item,
    options?: CreateNoteOptions,
  ): Promise<CreateNoteResult>;
  /** @see updateNote */
  updateNote(
    file: TFile,
    options: {
      indexedKey: string;
      scope?: UpdateScope;
      profileId?: string | null;
    },
  ): Promise<UpdateResult>;
  /** Re-stamp one note after explicit user consent, then refresh it. */
  switchNoteProfile(
    file: TFile,
    options: {
      indexedKey: string;
      profileId: string | null;
      importedNotes?: readonly TFile[];
    },
  ): Promise<UpdateResult>;
  /** Re-stamp one Imported Note; its next re-import follows this Profile. */
  switchImportedNoteProfile(
    file: TFile,
    options: { profileId: string | null },
  ): Promise<UpdateResult>;
  /** Imported Notes currently materialized for one Zotero item. */
  getImportedNotesForItem(indexedKey: string): Promise<TFile[]>;
  /** @see overwriteNote */
  overwriteNote(file: TFile, indexedKey: string): Promise<UpdateResult>;
  /** @see writeNoteUpdate */
  writeNoteUpdate(
    file: TFile,
    options: WriteNoteUpdateOptions,
  ): Promise<UpdateResult>;
  /** @see renderCitation */
  renderCitation(items: readonly CiteRef[], secondary?: boolean): string | null;
  /** @see renderAnnotation */
  renderAnnotation(
    annotationItemId: number,
    options: {
      attachmentImport: Pick<AttachmentImport, "decide" | "resolveLink">;
    },
  ): string | null;
  /** @see renderAnnotationCitation */
  renderAnnotationCitation(annotationItemId: number): string | null;
  /** Subscribe to {@link NoteFeatureEvents}; returns an unsubscribe. */
  on<K extends keyof NoteFeatureEvents>(
    event: K,
    cb: NoteFeatureEvents[K],
  ): () => void;
}

/**
 * Bind the note-feature operations to `deps` once (in `build.ts`). The bound
 * object is the module's external seam — consumers call its methods and never
 * see the collaborators. The closure serializes creates by Indexed Key and
 * retains newly created files until the Note Index observes them. Compiled
 * template artifacts live in {@link TemplateService}.
 */
export function createNoteFeature(deps: SyncRenderDeps): NoteFeature {
  const events = createNanoEvents<NoteFeatureEvents>();
  const ctx: SyncRenderDeps & OpsContext = { ...deps, events };
  const pendingCreates = new Map<string, Promise<CreateNoteResult>>();
  const createdBeforeIndex = new Map<string, TFile>();

  const createAtGate = (
    item: Item,
    options?: CreateNoteOptions,
  ): Promise<CreateNoteResult> => {
    const { indexedKey } = item;
    const pending = pendingCreates.get(indexedKey);
    if (pending) {
      return pending.then((result) =>
        result.outcome === "created"
          ? refusedCreate(indexedKey, [result.file])
          : result,
      );
    }

    const recent = createdBeforeIndex.get(indexedKey);
    if (recent) {
      const indexed = deps.noteIndex.getNotesByItemKey(indexedKey);
      if (indexed.length > 0) {
        createdBeforeIndex.delete(indexedKey);
        return Promise.resolve(refusedCreate(indexedKey, indexed));
      }
      if (deps.app.vault.getAbstractFileByPath(recent.path) === recent) {
        const cache = deps.app.metadataCache.getFileCache(recent);
        if (cache === null || itemKeyFromFrontmatter(cache) === indexedKey) {
          return Promise.resolve(refusedCreate(indexedKey, [recent]));
        }
      }
      createdBeforeIndex.delete(indexedKey);
    }

    const task = createNote(ctx, item, {
      ...options,
      onFileCreated: (file) => {
        if (
          createdBeforeIndex.size >= MAX_UNINDEXED_CREATES &&
          !createdBeforeIndex.has(indexedKey)
        ) {
          const oldest = createdBeforeIndex.keys().next().value;
          if (oldest !== undefined) createdBeforeIndex.delete(oldest);
        }
        createdBeforeIndex.set(indexedKey, file);
      },
    });
    pendingCreates.set(indexedKey, task);
    void task.then(
      () => {
        if (pendingCreates.get(indexedKey) === task) {
          pendingCreates.delete(indexedKey);
        }
      },
      () => {
        if (pendingCreates.get(indexedKey) === task) {
          pendingCreates.delete(indexedKey);
        }
      },
    );
    return task;
  };

  return {
    ready: Promise.all([deps.template.ready, deps.noteIndex.ready]).then(
      () => {},
    ),
    createNote: createAtGate,
    updateNote: (file, options) => updateNote(ctx, file, options),
    switchNoteProfile: (file, options) => switchNoteProfile(ctx, file, options),
    switchImportedNoteProfile: (file, options) =>
      switchImportedNoteProfile(ctx, file, options),
    getImportedNotesForItem: (indexedKey) =>
      getImportedNotesForItem(ctx, indexedKey),
    overwriteNote: (file, indexedKey) => overwriteNote(ctx, file, indexedKey),
    writeNoteUpdate: (file, options) => writeNoteUpdate(ctx, file, options),
    renderCitation: (items, secondary = false) =>
      renderCitation(ctx, items, secondary),
    renderAnnotation: (annotationItemId, options) =>
      renderAnnotation(ctx, annotationItemId, options),
    renderAnnotationCitation: (annotationItemId) =>
      renderAnnotationCitation(ctx, annotationItemId),
    on: (event, cb) => events.on(event, cb),
  };
}

function refusedCreate(
  indexedKey: string,
  existing: readonly TFile[],
): Extract<CreateNoteResult, { outcome: "refused" }> {
  const paths = existing.map((file) => file.path) as [string, ...string[]];
  return {
    outcome: "refused",
    diagnostic: {
      code:
        existing.length === 1
          ? "literature-note-exists"
          : "duplicate-literature-notes",
      hint:
        existing.length === 1
          ? "Open the existing Literature Note instead of creating another."
          : "Resolve the duplicate Literature Notes, then run create again.",
      indexedKey,
      paths,
    },
  };
}

/**
 * The bound feature serializes calls by Indexed Key before this operation.
 * This operation checks the settled Note Index before it writes. After that
 * check, `vault.create` is the atomic filename gate: on a collision, the name
 * is re-resolved with a forced `suffix()` and the write retried. Without a
 * `suffix()` marker there is nothing to disambiguate, so the collision
 * surfaces to the caller.
 *
 * @throws {@link EmptyFilenameError} when the rendered filename is empty, or an
 *   Obsidian vault error (e.g. a colliding path with no `suffix()` marker, or
 *   retries exhausted).
 */
async function createNote(
  ctx: OpsContext,
  item: Item,
  options: CreateNoteInternalOptions = {},
): Promise<CreateNoteResult> {
  const collectionCache = options.collectionCache ?? new CollectionCache();
  const tagMemo: TagMemo = options.tagMemo ?? new Map();
  const [settings] = await Promise.all([
    ctx.settings.loaded,
    ctx.noteIndex.whenIndexed(),
    ctx.template.ready,
  ]);
  const requestedProfileId = options.profileId ?? undefined;
  const profile = resolveLiteratureNoteProfile(settings, requestedProfileId);
  if (!profile) {
    return refusedUnknownProfile(requestedProfileId!, {
      indexedKey: item.indexedKey,
    });
  }
  if (conversionRequired(settings, requestedProfileId)) {
    return refusedTemplateConversion(requestedProfileId!, {
      indexedKey: item.indexedKey,
    });
  }
  const existing = ctx.noteIndex.getNotesByItemKey(item.indexedKey);
  if (existing.length > 0) {
    if (existing.length === 1 && options.profileId !== undefined) {
      const existingProfileId = stampedProfileId(ctx, existing[0]!);
      if (!resolveLiteratureNoteProfile(settings, existingProfileId)) {
        return refusedUnknownProfile(existingProfileId!, {
          indexedKey: item.indexedKey,
          path: existing[0]!.path,
        });
      }
      if (existingProfileId !== requestedProfileId) {
        return refusedProfileConflict(item.indexedKey, existing[0]!, {
          existingProfileId,
          requestedProfileId,
        });
      }
    }
    return refusedCreate(item.indexedKey, existing);
  }
  const document = resolveProfileDocument(ctx, profile);
  if (document === null) {
    return refusedMissingDocument(profile.document!, {
      indexedKey: item.indexedKey,
    });
  }
  // Pin the client across the async vault write and the child-note import flush
  // so an auto-refresh swap can't dispose it mid-operation; `lease.client` is
  // threaded through the helpers so they read one stable snapshot.
  using lease = await ctx.db.acquireRead();
  const username =
    options.username !== undefined
      ? options.username
      : getZoteroIdentity(lease.client).username;
  const itemTags = resolveItemTags(lease.client, item.itemID, tagMemo);
  const itemCollections = fetchItemCollections(
    collectionCache,
    lease.client,
    item,
  );
  let { path, canSuffix } = resolveNotePath(ctx, item, {
    itemTags,
    itemCollections,
    settings: profile.settings,
    document,
  });

  for (let attempt = 0; ; attempt++) {
    let fileCreated = false;
    try {
      const result = await writeNewNote(ctx, item, {
        client: lease.client,
        tagMemo,
        collectionCache,
        path,
        settings: profile.settings,
        profile,
        document,
        groupIdMemo: options.groupIdMemo,
        username,
        onFileCreated: (created) => {
          fileCreated = true;
          options.onFileCreated?.(created);
        },
      });
      return result;
    } catch (error) {
      if (
        fileCreated ||
        !isFileExistsError(error) ||
        !canSuffix ||
        attempt >= MAX_CREATE_RETRIES
      ) {
        throw error;
      }
      logger.debug("Filename collided on create; retrying with suffix", {
        path,
        attempt,
        itemKey: item.indexedKey,
      });
      ({ path, canSuffix } = resolveNotePath(ctx, item, {
        itemTags,
        itemCollections,
        settings: profile.settings,
        forceSuffix: true,
        document,
      }));
    }
  }
}

/**
 * Inner write step for {@link createNote}, which handles path resolution and
 * collision retries before calling here.
 *
 * @throws an Obsidian vault error (e.g. a file already exists at `path`).
 */
async function writeNewNote(
  ctx: OpsContext,
  item: Item,
  options: {
    client: NodeDatabaseClient;
    tagMemo: TagMemo;
    collectionCache: CollectionCache;
    path: string;
    settings: Readonly<Settings>;
    profile: ResolvedLiteratureNoteProfile;
    document: ResolvedLiteratureNoteTemplate | undefined;
    groupIdMemo?: GroupIDMemo;
    username: string | null;
    onFileCreated?: (file: TFile) => void;
  },
): Promise<CreateNoteResult> {
  const { tagMemo, collectionCache, path, settings } = options;
  await ensureParentFolder(ctx.app, path);

  const attachmentImport = await ctx.attachmentImport.prepare(path);
  const noteImport = await ctx.noteImport.prepare({
    client: options.client,
    sourcePath: path,
    settings,
    groupIdMemo: options.groupIdMemo,
    tagMemo,
  });
  const resolvers = buildNoteResolvers(ctx, {
    attachmentImport,
    noteImport,
    settings,
    sourcePath: path,
  });
  const context = fetchNoteContext(options.client, item, {
    resolvers,
    tagMemo,
    collectionCache,
    groupIdMemo: options.groupIdMemo,
    username: options.username,
  });
  const prepared = prepareFrontmatter({
    context,
    itemKey: item.indexedKey,
    document: options.document,
    diagnosticContext: { indexedKey: item.indexedKey },
  });
  if ("diagnostic" in prepared) {
    return { outcome: "refused", diagnostic: prepared.diagnostic };
  }
  const body = options.document
    ? options.document.renderForCreate(context)
    : ctx.template.render("note", context);
  const fm: Record<string, unknown> = {};
  applyFrontmatter(ctx, fm, {
    context,
    itemKey: item.indexedKey,
    profile: options.profile,
    prepared,
  });
  const content = `---\n${
    prepared.kind === "document"
      ? stringifyFrontmatterInOrder(
          fm,
          prepared.fields.map(({ key }) => key),
        )
      : stringifyYaml(fm)
  }---\n${body}`;

  const file = await ctx.app.vault.create(path, content);
  options.onFileCreated?.(file);
  await attachmentImport.flush();
  await noteImport.flush();
  logger.debug("Created literature note", { path, itemKey: item.indexedKey });
  return { outcome: "created", file };
}

async function updateNote(
  ctx: OpsContext,
  file: TFile,
  options: {
    indexedKey: string;
    scope?: UpdateScope;
    profileId?: string | null;
    profileOverride?: string | null;
  },
): Promise<UpdateResult> {
  const { indexedKey, scope = "full", profileOverride } = options;
  // Settle readiness and prepare the attachment handle before pinning the
  // client, so the lease (an auto-refresh gate) spans only the DB reads, the
  // vault writes, and the child-note import flush — not the warm-up awaits.
  const [settings] = await Promise.all([
    ctx.settings.loaded,
    ctx.noteIndex.whenIndexed(),
    ctx.template.ready,
  ]);
  const stampedId = stampedProfileId(ctx, file);
  if (profileOverride === undefined && options.profileId !== undefined) {
    const requestedId = options.profileId ?? undefined;
    if (!resolveLiteratureNoteProfile(settings, requestedId)) {
      return refusedUpdateProfile(requestedId!, file.path);
    }
    if (requestedId !== stampedId) {
      return refusedUpdateProfileConflict(indexedKey, file.path, {
        existingProfileId: stampedId,
        requestedProfileId: requestedId,
      });
    }
  }
  const profileId =
    profileOverride === undefined ? stampedId : (profileOverride ?? undefined);
  const profile = resolveLiteratureNoteProfile(settings, profileId);
  if (!profile) return refusedUpdateProfile(profileId!, file.path);
  if (conversionRequired(settings, profileId)) {
    return refusedUpdateTemplateConversion(profileId!, file.path);
  }
  const document = resolveProfileDocument(ctx, profile);
  if (document === null) {
    return refusedUpdateMissingDocument(profile.document!, file.path);
  }
  const attachmentImport = await ctx.attachmentImport.prepare(file.path);
  using lease = await ctx.db.acquireRead();
  const { context, noteImport } = await contextForIndexedKey(ctx, indexedKey, {
    client: lease.client,
    attachmentImport,
    sourcePath: file.path,
    settings: profile.settings,
  });
  return applyManagedUpdate(ctx, file, {
    context,
    attachmentImport,
    noteImport,
    itemKey: indexedKey,
    scope,
    profile,
    document,
  });
}

async function switchNoteProfile(
  ctx: OpsContext,
  file: TFile,
  options: {
    indexedKey: string;
    profileId: string | null;
    importedNotes?: readonly TFile[];
  },
): Promise<UpdateResult> {
  const settings = await ctx.settings.loaded;
  const profileId = options.profileId ?? undefined;
  const profile = resolveLiteratureNoteProfile(settings, profileId);
  if (!profile) return refusedUpdateProfile(profileId!, file.path);
  if (conversionRequired(settings, profileId)) {
    return refusedUpdateTemplateConversion(profileId!, file.path);
  }
  const document = resolveProfileDocument(ctx, profile);
  if (document === null) {
    return refusedUpdateMissingDocument(profile.document!, file.path);
  }
  const previousProfileId = stampedProfileId(ctx, file);
  await stampNoteProfile(ctx, file, profileId);
  let result: UpdateResult;
  try {
    result = await updateNote(ctx, file, {
      indexedKey: options.indexedKey,
      profileOverride: options.profileId,
    });
    if (result.diagnostic) {
      await stampNoteProfile(ctx, file, previousProfileId);
    }
  } catch (error) {
    await stampNoteProfile(ctx, file, previousProfileId);
    throw error;
  }
  if (result.diagnostic) return result;

  await stampImportedNoteFamily(ctx, options.importedNotes ?? [], profileId);
  return result;
}

async function switchImportedNoteProfile(
  ctx: OpsContext,
  file: TFile,
  options: { profileId: string | null },
): Promise<UpdateResult> {
  const settings = await ctx.settings.loaded;
  const profileId = options.profileId ?? undefined;
  if (!resolveLiteratureNoteProfile(settings, profileId)) {
    return refusedUpdateProfile(profileId!, file.path);
  }
  await stampNoteProfile(ctx, file, profileId);
  return NO_BODY_UPDATE;
}

async function getImportedNotesForItem(
  ctx: NoteFeatureDeps,
  indexedKey: string,
): Promise<TFile[]> {
  await ctx.noteIndex.whenIndexed();
  using lease = await ctx.db.acquireRead();
  const parsed = resolveIndexedKeyLibrary(lease.client, indexedKey);
  if (!parsed) throw new Error(`Zotero item not found: ${indexedKey}`);
  const item = getItemsByKey(lease.client, parsed.libraryID, [parsed.key])[0];
  if (!item) throw new Error(`Zotero item not found: ${indexedKey}`);
  return getChildNotesByParentIDs(lease.client, [item.itemID]).flatMap((note) =>
    ctx.noteIndex.getImportedNoteByNoteKey(note.indexedKey),
  );
}

async function stampImportedNoteFamily(
  ctx: NoteFeatureDeps,
  files: readonly TFile[],
  profileId: string | undefined,
): Promise<void> {
  const previous = files.map(
    (file) => [file, stampedProfileId(ctx, file)] as const,
  );
  const attempted: typeof previous = [];
  try {
    for (const entry of previous) {
      attempted.push(entry);
      await stampNoteProfile(ctx, entry[0], profileId);
    }
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    for (const [file, previousProfileId] of attempted.toReversed()) {
      try {
        await stampNoteProfile(ctx, file, previousProfileId);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        "Imported Note Profile switch and rollback failed",
      );
    }
    throw error;
  }
}

async function stampNoteProfile(
  ctx: NoteFeatureDeps,
  file: TFile,
  profileId: string | undefined,
): Promise<void> {
  await ctx.app.fileManager.processFrontMatter(file, (fm) => {
    if (profileId === undefined) delete fm[FIELD_LITERATURE_NOTE_PROFILE];
    else fm[FIELD_LITERATURE_NOTE_PROFILE] = profileId;
  });
}

/**
 * Update an existing note from an already-fetched `item`. The batch runner
 * calls this to reuse the item it classified, skipping the per-item
 * resolution {@link updateNote} does via `indexedKey` (re-deriving the
 * library and re-querying the item).
 *
 * Assumes the caller has gated database, note-index, and template readiness;
 * the batch runner does so once for the whole run, so unlike {@link updateNote}
 * (via {@link contextForIndexedKey}) this does not await them itself.
 */
async function writeNoteUpdate(
  ctx: OpsContext,
  file: TFile,
  options: WriteNoteUpdateOptions,
): Promise<UpdateResult> {
  const profileId = stampedProfileId(ctx, file);
  if (options.profileId !== undefined) {
    const requestedId = options.profileId ?? undefined;
    if (!resolveLiteratureNoteProfile(options.settings, requestedId)) {
      return refusedUpdateProfile(requestedId!, file.path);
    }
    if (requestedId !== profileId) {
      return refusedUpdateProfileConflict(options.item.indexedKey, file.path, {
        existingProfileId: profileId,
        requestedProfileId: requestedId,
      });
    }
  }
  const profile = resolveLiteratureNoteProfile(options.settings, profileId);
  if (!profile) return refusedUpdateProfile(profileId!, file.path);
  if (conversionRequired(options.settings, profileId)) {
    return refusedUpdateTemplateConversion(profileId!, file.path);
  }
  const document = resolveProfileDocument(ctx, profile);
  if (document === null) {
    return refusedUpdateMissingDocument(profile.document!, file.path);
  }
  const attachmentImport = await ctx.attachmentImport.prepare(file.path);
  const noteImport = await ctx.noteImport.prepare({
    client: options.client,
    sourcePath: file.path,
    settings: profile.settings,
    groupIdMemo: options.groupIdMemo,
    tagMemo: options.tagMemo,
  });
  const resolvers = buildNoteResolvers(ctx, {
    attachmentImport,
    noteImport,
    settings: profile.settings,
    sourcePath: file.path,
  });
  const context = fetchNoteContext(options.client, options.item, {
    resolvers,
    tagMemo: options.tagMemo,
    collectionCache: options.collectionCache,
    groupIdMemo: options.groupIdMemo,
    username: options.username,
  });
  return applyManagedUpdate(ctx, file, {
    context,
    attachmentImport,
    noteImport,
    itemKey: options.item.indexedKey,
    scope: options.scope ?? "full",
    profile,
    document,
  });
}

/** Compose a managed update from its steps: prepare and refresh frontmatter,
 *  then for the `full` scope replace the managed body region. A document field
 *  refusal returns before either write. Shared by
 *  {@link updateNote} and {@link writeNoteUpdate}; the caller supplies the
 *  already-built context and its prepared `attachmentImport`. */
async function applyManagedUpdate(
  ctx: OpsContext,
  file: TFile,
  input: {
    context: NoteTemplateContext;
    attachmentImport: Pick<AttachmentImport, "flush">;
    noteImport: Pick<NoteImport, "flush">;
    itemKey: string;
    scope: UpdateScope;
    profile: ResolvedLiteratureNoteProfile;
    document: ResolvedLiteratureNoteTemplate | undefined;
  },
): Promise<UpdateResult> {
  const {
    context,
    attachmentImport,
    noteImport,
    itemKey,
    scope,
    profile,
    document,
  } = input;
  const diagnostic = await refreshFrontmatter(ctx, file, {
    context,
    itemKey,
    profile,
    document,
  });
  if (diagnostic) return { ...NO_BODY_UPDATE, diagnostic };
  const result =
    scope === "full"
      ? document
        ? await replaceDocumentManagedBody(ctx, file, {
            context,
            itemKey,
            document,
          })
        : await replaceManagedBody(ctx, file, { context, itemKey })
      : NO_BODY_UPDATE;

  await Promise.all([attachmentImport.flush(), noteImport.flush()]);

  logger.debug("Updated literature note", {
    path: file.path,
    itemKey,
    scope,
    bodyUpdated: result.bodyUpdated,
  });
  return result;
}

async function replaceDocumentManagedBody(
  ctx: NoteFeatureDeps,
  file: TFile,
  input: {
    context: NoteTemplateContext;
    itemKey: string;
    document: ResolvedLiteratureNoteTemplate;
  },
): Promise<UpdateResult> {
  const { context, itemKey, document } = input;
  if (!document.hasManagedBlock) {
    return { ...NO_BODY_UPDATE, noManagedBlock: true };
  }
  return replaceManagedBody(ctx, file, {
    context,
    itemKey,
    renderRegion: () => document.renderForUpdate(context)!,
  });
}

/** Replace the managed body region in place, re-rendering the `content`
 *  template. The engine's transformRender wraps `content` in the managed-region
 *  markers, so the render is already wrapped. */
async function replaceManagedBody(
  ctx: NoteFeatureDeps,
  file: TFile,
  input: {
    context: NoteTemplateContext;
    itemKey: string;
    renderRegion?: () => string;
  },
): Promise<UpdateResult> {
  const { context, itemKey, renderRegion } = input;
  let replaced = false;
  let duplicateCount = 0;
  await ctx.app.vault.process(file, (content) => {
    // replaceManagedRegion only invokes the provider when a region exists,
    // so rendering `content` — and the attachment imports its lazy imgLink
    // closures queue as a side effect — is skipped when there is no region.
    const result = replaceManagedRegion(content, () =>
      renderRegion ? renderRegion() : ctx.template.render("content", context),
    );
    replaced = result.replaced;
    duplicateCount = result.duplicateCount;
    return result.content;
  });

  if (duplicateCount > 0) {
    logger.warn("Literature note has duplicate managed regions", {
      path: file.path,
      itemKey,
      count: duplicateCount + 1,
    });
  }
  return { bodyUpdated: replaced, duplicateRegionCount: duplicateCount };
}

async function overwriteNote(
  ctx: OpsContext,
  file: TFile,
  indexedKey: string,
): Promise<UpdateResult> {
  // Settle readiness and prepare the attachment handle before pinning the
  // client, so the lease (an auto-refresh gate) spans only the DB reads, the
  // vault writes, and the child-note import flush — not the warm-up awaits.
  const [settings] = await Promise.all([
    ctx.settings.loaded,
    ctx.noteIndex.whenIndexed(),
    ctx.template.ready,
  ]);
  const profileId = stampedProfileId(ctx, file);
  const profile = resolveLiteratureNoteProfile(settings, profileId);
  if (!profile) return refusedUpdateProfile(profileId!, file.path);
  if (conversionRequired(settings, profileId)) {
    return refusedUpdateTemplateConversion(profileId!, file.path);
  }
  const document = resolveProfileDocument(ctx, profile);
  if (document === null) {
    return refusedUpdateMissingDocument(profile.document!, file.path);
  }
  const attachmentImport = await ctx.attachmentImport.prepare(file.path);
  using lease = await ctx.db.acquireRead();
  const { context, noteImport } = await contextForIndexedKey(ctx, indexedKey, {
    client: lease.client,
    attachmentImport,
    sourcePath: file.path,
    settings: profile.settings,
  });
  const diagnostic = await refreshFrontmatter(ctx, file, {
    context,
    itemKey: indexedKey,
    profile,
    document,
  });
  if (diagnostic) return { ...NO_BODY_UPDATE, diagnostic };
  const body = document
    ? document.renderForCreate(context)
    : ctx.template.render("note", context);
  await ctx.app.vault.process(file, (content) => {
    const prefix = FRONTMATTER_BLOCK.exec(content)?.[0] ?? "";
    return `${prefix}${body}`;
  });

  await Promise.all([attachmentImport.flush(), noteImport.flush()]);
  logger.info("Overwrote literature note", {
    path: file.path,
    itemKey: indexedKey,
  });
  return { bodyUpdated: true, duplicateRegionCount: 0 };
}

/**
 * Render the configured cite template for the given items. Synchronous (called
 * from `selectSuggestion`/`onChooseSuggestion` handlers, which can't await), so
 * it returns `null` instead of throwing when the template isn't loaded yet;
 * the caller shows a "still loading" notice in that case.
 *
 * @param secondary - render the bare `cite2` template (narrative/in-prose,
 *   e.g. `@key`) instead of the default bracketed `cite` template (`[@key]`).
 * @returns the rendered citation in inline form ({@link inlineCitation}).
 */
function renderCitation(
  ctx: NoteFeatureDeps,
  items: readonly CiteRef[],
  secondary = false,
): string | null {
  if (!ctx.template.loaded) return null;
  return inlineCitation(
    ctx.template.render(
      secondary ? "cite2" : "cite",
      citekeysToCiteTemplateData(items),
    ),
  );
}

/**
 * Render a single annotation through the `annotation` template for the annot
 * view's drag-insert. Synchronous (so it can populate `dataTransfer` during
 * `dragstart`): reads the sync `db` view off `ctx` and needs a pre-prepared
 * `attachmentImport` handle whose `flush()` the caller runs on drop. Only the
 * dragged annotation's template is rendered, so only its excerpt image is
 * queued for import. Returns `null` when the item or annotation can't be
 * resolved, the database is not ready, or the template is not ready.
 */
function renderAnnotation(
  ctx: SyncRenderDeps,
  annotationItemId: number,
  options: {
    attachmentImport: Pick<AttachmentImport, "decide" | "resolveLink">;
  },
): string | null {
  const { db } = ctx;
  if (db.state !== "ready") return null;
  if (!ctx.template.loaded) return null;
  const settings = ctx.settings.current;
  if (!settings) return null;

  const [annotation] = getAnnotationsByItemId(db.client, [annotationItemId]);
  if (!annotation) return null;

  return (
    renderAnnotations(db.client, [annotation], {
      template: ctx.template,
      zoteroPref: ctx.zoteroPref,
      attachmentImport: options.attachmentImport,
      renderAnnotation: (data) => {
        const indexedKey = data.parentItem?.indexedKey;
        const file = indexedKey
          ? ctx.noteIndex.getNotesByItemKey(indexedKey)[0]
          : undefined;
        return ctx.template.renderProfileAnnotation(data, {
          settings,
          profileId: file ? stampedProfileId(ctx, file) : undefined,
        });
      },
    }).get(annotation.key) ?? null
  );
}

/**
 * Render an annotation's page-pinned citation for the annot view's "Copy
 * citation" action: the same `cite`-template path {@link renderAnnotation}'s
 * `zt.citation` field uses, called directly (no excerpt image import needed
 * for a citation string, so the `attachmentImport` port is stubbed).
 * Returns `null` when the annotation, its parent item, or the parent's
 * citation key can't be resolved, or the database/template isn't ready.
 */
function renderAnnotationCitation(
  ctx: SyncRenderDeps,
  annotationItemId: number,
): string | null {
  const { db } = ctx;
  if (db.state !== "ready") return null;
  if (!ctx.template.loaded) return null;

  const [annotation] = getAnnotationsByItemId(db.client, [annotationItemId]);
  if (!annotation) return null;

  const resolvers = buildAnnotationResolvers({
    zoteroPref: ctx.zoteroPref,
    attachmentImport: {
      decide: (path, origin) => ({
        approved: false,
        path,
        origin,
        reason: "no-trusted-root",
      }),
      resolveLink: () => () => "",
    },
  });
  const data = fetchAnnotationsTemplateData(db.client, [annotation], {
    resolvers,
  }).get(annotation.key);
  if (!data) return null;

  return annotationCitation(data.parentItem, data.pageLabel, ctx.template);
}

/**
 * Assumes the caller has settled note-index and template readiness (and pinned
 * the client via `acquireRead`); {@link updateNote} and {@link overwriteNote} do
 * so before acquiring the lease. `template.ready` in particular gates
 * `refreshFrontmatter`, which reads `template.frontmatterFields` and writes
 * before `render()` would throw — without it, an early update could strip
 * managed frontmatter to the still-empty compiled fields.
 */
async function contextForIndexedKey(
  ctx: NoteFeatureDeps,
  indexedKey: string,
  options: {
    client: NodeDatabaseClient;
    attachmentImport: Pick<AttachmentImport, "decide" | "resolveLink">;
    sourcePath: string;
    settings: Readonly<Settings>;
  },
): Promise<{ context: NoteTemplateContext; noteImport: NoteImport }> {
  const { client, sourcePath, settings } = options;
  const parsed = resolveIndexedKeyLibrary(client, indexedKey);
  if (!parsed) throw new Error(`Zotero item not found: ${indexedKey}`);

  const [item] = getItemsByKey(client, parsed.libraryID, [parsed.key]);
  if (!item) throw new Error(`Zotero item not found: ${indexedKey}`);
  const noteImport = await ctx.noteImport.prepare({
    client,
    sourcePath,
    settings,
  });
  const resolvers = buildNoteResolvers(ctx, {
    attachmentImport: options.attachmentImport,
    noteImport,
    settings,
    sourcePath,
  });
  const context = fetchNoteContext(client, item, {
    resolvers,
    tagMemo: new Map(),
    collectionCache: new CollectionCache(),
    username: getZoteroIdentity(client).username,
  });
  return { context, noteImport };
}

async function refreshFrontmatter(
  ctx: OpsContext,
  file: TFile,
  input: {
    context: NoteTemplateContext;
    itemKey: string;
    profile: ResolvedLiteratureNoteProfile;
    document: ResolvedLiteratureNoteTemplate | undefined;
  },
): Promise<ManagedFrontmatterRefusalDiagnostic | undefined> {
  const prepared = prepareFrontmatter({
    context: input.context,
    itemKey: input.itemKey,
    document: input.document,
    diagnosticContext: { path: file.path },
  });
  if ("diagnostic" in prepared) return prepared.diagnostic;
  await ctx.app.fileManager.processFrontMatter(file, (fm) => {
    applyFrontmatter(ctx, fm, { ...input, prepared });
  });
}

function prepareFrontmatter(input: {
  context: NoteTemplateContext;
  itemKey: string;
  document: ResolvedLiteratureNoteTemplate | undefined;
  diagnosticContext: { path?: string; indexedKey?: string };
}):
  | PreparedManagedFrontmatter
  | { diagnostic: ManagedFrontmatterRefusalDiagnostic } {
  const frontmatter = input.document?.frontmatter;
  const result = prepareManagedFrontmatter(
    frontmatter,
    input.context,
    Temporal.Now.instant(),
  );
  if ("prepared" in result) return result.prepared;

  const failures = result.failures.map(({ key: field, reason, error }) => {
    if (reason === "evaluation") {
      logger.warn("Managed Frontmatter field failed", {
        key: field,
        itemKey: input.itemKey,
        error,
      });
      return {
        field,
        message: m.managed_frontmatter_eval_failure({ field }),
        hint: m.managed_frontmatter_eval_recovery({ field }),
      };
    }
    return {
      field,
      message: m.managed_frontmatter_inert_failure({ field }),
      hint: m.managed_frontmatter_inert_recovery({ field }),
    };
  }) as [
    ManagedFrontmatterFailureDiagnostic,
    ...ManagedFrontmatterFailureDiagnostic[],
  ];
  return {
    diagnostic: {
      code: "managed-frontmatter-refused",
      hint: m.managed_frontmatter_refused_recovery(),
      failures,
      ...input.diagnosticContext,
    },
  };
}

/** Apply one prepared document patch or the legacy settings-held field set. */
function applyFrontmatter(
  ctx: OpsContext,
  fm: Record<string, unknown>,
  input: {
    context: NoteTemplateContext;
    itemKey: string;
    profile: ResolvedLiteratureNoteProfile;
    prepared: PreparedManagedFrontmatter;
  },
): void {
  const { context, itemKey, profile, prepared } = input;
  const failed: string[] = [];
  const onConflict = (key: string, detail: { reason: "shape-mismatch" }) => {
    logger.warn("Skipped frontmatter append", { key, itemKey, ...detail });
  };
  if (prepared.kind === "document") {
    applyDocumentManagedFrontmatter(fm, context, { prepared, onConflict });
  } else {
    applyManagedFrontmatter(fm, context, {
      compiled: ctx.template.frontmatterFields,
      onError: (key, error) => {
        failed.push(key);
        logger.warn("Frontmatter expression failed", { key, itemKey, error });
      },
      onConflict,
    });
  }
  if (failed.length > 0) {
    ctx.events.emit("frontmatter-eval-failed", { itemKey, fields: failed });
  }
  if (profile.id === undefined) delete fm[FIELD_LITERATURE_NOTE_PROFILE];
  else fm[FIELD_LITERATURE_NOTE_PROFILE] = profile.id;
  if (profile.citationStyle == null) delete fm[FIELD_CITATION_STYLE];
  else fm[FIELD_CITATION_STYLE] = profile.citationStyle;
}

interface ResolvedLiteratureNoteProfile {
  id: string | undefined;
  document: string | undefined;
  settings: ProfileBindingSettings;
  citationStyle: string | null | undefined;
}

function resolveLiteratureNoteProfile(
  settings: Readonly<Settings>,
  id: string | undefined,
): ResolvedLiteratureNoteProfile | undefined {
  if (id === undefined) {
    return {
      id,
      document: settings["note.default-profile"].document,
      settings: bindLiteratureNoteProfile(settings)!,
      citationStyle: undefined,
    };
  }
  const profile = settings["note.profiles"].find(
    (candidate) => candidate.id === id,
  );
  if (!profile) return undefined;
  return {
    id,
    document: profile.document,
    settings: bindLiteratureNoteProfile(settings, id)!,
    citationStyle: profile.bindings?.["citation.references-style"],
  };
}

function conversionRequired(
  settings: Readonly<Settings>,
  profileId: string | undefined,
): boolean {
  return (
    settings["note.template-conversion-pending"] && profileId !== undefined
  );
}

function resolveProfileDocument(
  ctx: NoteFeatureDeps,
  profile: ResolvedLiteratureNoteProfile,
): ResolvedLiteratureNoteTemplate | undefined | null {
  if (profile.document === undefined) return undefined;
  return ctx.template.getLiteratureNoteTemplate(profile.document) ?? null;
}

function stampedProfileId(
  ctx: NoteFeatureDeps,
  file: TFile,
): string | undefined {
  const value =
    ctx.app.metadataCache.getFileCache(file)?.frontmatter?.[
      FIELD_LITERATURE_NOTE_PROFILE
    ];
  return value === undefined ? undefined : String(value);
}

function refusedUnknownProfile(
  profileId: string,
  context: { path?: string; indexedKey?: string },
): {
  outcome: "refused";
  diagnostic: UnknownNoteProfileDiagnostic;
} {
  return {
    outcome: "refused",
    diagnostic: {
      code: "unknown-literature-note-profile",
      hint: "Re-stamp the note or recreate the Profile with the same ID.",
      profileId,
      ...context,
    },
  };
}

function refusedUpdateProfile(profileId: string, path: string): UpdateResult {
  return {
    ...NO_BODY_UPDATE,
    diagnostic: refusedUnknownProfile(profileId, { path }).diagnostic,
  };
}

function refusedMissingDocument(
  document: string,
  context: { path?: string; indexedKey?: string },
): { outcome: "refused"; diagnostic: MissingLiteratureNoteTemplateDiagnostic } {
  return {
    outcome: "refused",
    diagnostic: {
      code: "missing-literature-note-template",
      hint: `Restore '${document}' in the template folder or clear the Profile document reference.`,
      document,
      ...context,
    },
  };
}

function refusedUpdateMissingDocument(
  document: string,
  path: string,
): UpdateResult {
  return {
    ...NO_BODY_UPDATE,
    diagnostic: refusedMissingDocument(document, { path }).diagnostic,
  };
}

function refusedTemplateConversion(
  profileId: string,
  context: { path?: string; indexedKey?: string },
): {
  outcome: "refused";
  diagnostic: LiteratureNoteTemplateConversionRequiredDiagnostic;
} {
  return {
    outcome: "refused",
    diagnostic: {
      code: "literature-note-template-conversion-required",
      hint: "Convert the legacy Literature Note Templates before using added Profiles.",
      profileId,
      ...context,
    },
  };
}

function refusedUpdateTemplateConversion(
  profileId: string,
  path: string,
): UpdateResult {
  return {
    ...NO_BODY_UPDATE,
    diagnostic: refusedTemplateConversion(profileId, { path }).diagnostic,
  };
}

function refusedUpdateProfileConflict(
  indexedKey: string,
  path: string,
  profiles: {
    existingProfileId: string | undefined;
    requestedProfileId: string | undefined;
  },
): UpdateResult {
  return {
    ...NO_BODY_UPDATE,
    diagnostic: {
      code: "literature-note-profile-conflict",
      hint: "Follow the stamped Profile, or switch the note interactively before this headless update.",
      indexedKey,
      path,
      existingProfileId: profiles.existingProfileId ?? null,
      requestedProfileId: profiles.requestedProfileId ?? null,
    },
  };
}

function refusedProfileConflict(
  indexedKey: string,
  file: TFile,
  profiles: {
    existingProfileId: string | undefined;
    requestedProfileId: string | undefined;
  },
): Extract<CreateNoteResult, { outcome: "refused" }> {
  return {
    outcome: "refused",
    diagnostic: {
      code: "literature-note-profile-conflict",
      hint: "Keep the existing Profile, or switch the note to the requested Profile and refresh its managed content.",
      indexedKey,
      path: file.path,
      existingProfileId: profiles.existingProfileId ?? null,
      requestedProfileId: profiles.requestedProfileId ?? null,
    },
  };
}
