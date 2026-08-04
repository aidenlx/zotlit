import { stringifyYaml, type TFile } from "obsidian";

import {
  citekeysToCiteTemplateData,
  CollectionCache,
  fetchAnnotationsTemplateData,
  fetchNoteContext,
  getAnnotationsByItemId,
  getZoteroIdentity,
  getItemsByKey,
  resolveIndexedKeyLibrary,
  resolveItemTags,
  type CiteRef,
  type GroupIDMemo,
  type Item,
  type NoteTemplateContext,
  type TagMemo,
} from "@zotlit/db";
import { type NodeDatabaseClient } from "@zotlit/db/client/node";
import { type UpdateScope } from "@zotlit/protocol";
import { createNanoEvents, type Emitter } from "@zotlit/shared/nanoevents";
import { replaceManagedRegion } from "@zotlit/templates/obsidian";

import {
  annotationCitation,
  buildAnnotationResolvers,
  renderAnnotations,
} from "@/lib/annotation-render";
import { ensureParentFolder } from "@/lib/ensure-folder";
import { inlineCitation } from "@/lib/inline-citation";
import { getLogger } from "@/lib/log";
import { isFileExistsError } from "@/lib/vault-errors";
import { type AttachmentImport } from "@/services/attachment-import/service";
import { type NoteImport } from "@/services/note-import/service";
import { type Settings } from "@/services/settings/schema";

import {
  buildNoteResolvers,
  fetchItemCollections,
  resolveNotePath,
  type NoteFeatureDeps,
  type SyncRenderDeps,
} from "./context";
import { applyManagedFrontmatter } from "./frontmatter";

const logger = getLogger("note-feature");

// Tolerates CRLF: Obsidian's processFrontMatter preserves the note's
// original line-ending bytes in the `---` delimiters, so a CRLF-authored
// note must still match here or its frontmatter prefix is dropped.
const FRONTMATTER_BLOCK = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n+|$)/;

export interface UpdateResult {
  bodyUpdated: boolean;
  duplicateRegionCount: number;
}

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
}

/** Events the bound note feature emits; a UI subscriber owns any rendering. */
export interface NoteFeatureEvents {
  /**
   * Frontmatter field expressions threw during a write; the write still
   * completed with those keys skipped.
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
  createNote(item: Item, options?: CreateNoteOptions): Promise<TFile>;
  /** @see updateNote */
  updateNote(
    file: TFile,
    options: { indexedKey: string; scope?: UpdateScope },
  ): Promise<UpdateResult>;
  /** @see overwriteNote */
  overwriteNote(file: TFile, indexedKey: string): Promise<void>;
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
 * see the collaborators. Holds no state of its own; the closure only captures
 * `deps` and the feature's event emitter, and compiled template artifacts live
 * in {@link TemplateService}.
 */
export function createNoteFeature(deps: SyncRenderDeps): NoteFeature {
  const events = createNanoEvents<NoteFeatureEvents>();
  const ctx: SyncRenderDeps & OpsContext = { ...deps, events };
  return {
    ready: Promise.all([deps.template.ready, deps.noteIndex.ready]).then(
      () => {},
    ),
    createNote: (item, options) => createNote(ctx, item, options),
    updateNote: (file, options) => updateNote(ctx, file, options),
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

/**
 * `vault.create` is the atomic uniqueness gate: on a collision, the name is
 * re-resolved with a forced `suffix()` and the write retried. Without a
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
  options: CreateNoteOptions = {},
): Promise<TFile> {
  const collectionCache = options.collectionCache ?? new CollectionCache();
  const tagMemo: TagMemo = options.tagMemo ?? new Map();
  const [settings] = await Promise.all([
    ctx.settings.loaded,
    ctx.noteIndex.whenIndexed(),
    ctx.template.ready,
  ]);
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
    settings,
  });

  for (let attempt = 0; ; attempt++) {
    try {
      return await writeNewNote(ctx, item, {
        client: lease.client,
        tagMemo,
        collectionCache,
        path,
        settings,
        groupIdMemo: options.groupIdMemo,
        username,
      });
    } catch (error) {
      if (
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
        settings,
        forceSuffix: true,
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
    groupIdMemo?: GroupIDMemo;
    username: string | null;
  },
): Promise<TFile> {
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
  const body = ctx.template.render("note", context);
  const fm: Record<string, unknown> = {};
  applyFrontmatter(ctx, fm, { context, itemKey: item.indexedKey });
  const content = `---\n${stringifyYaml(fm)}---\n${body}`;

  const file = await ctx.app.vault.create(path, content);
  await attachmentImport.flush();
  await noteImport.flush();
  logger.debug("Created literature note", { path, itemKey: item.indexedKey });
  return file;
}

async function updateNote(
  ctx: OpsContext,
  file: TFile,
  options: { indexedKey: string; scope?: UpdateScope },
): Promise<UpdateResult> {
  const { indexedKey, scope = "full" } = options;
  // Settle readiness and prepare the attachment handle before pinning the
  // client, so the lease (an auto-refresh gate) spans only the DB reads, the
  // vault writes, and the child-note import flush — not the warm-up awaits.
  await Promise.all([ctx.noteIndex.whenIndexed(), ctx.template.ready]);
  const attachmentImport = await ctx.attachmentImport.prepare(file.path);
  using lease = await ctx.db.acquireRead();
  const { context, noteImport } = await contextForIndexedKey(ctx, indexedKey, {
    client: lease.client,
    attachmentImport,
    sourcePath: file.path,
  });
  return applyManagedUpdate(ctx, file, {
    context,
    attachmentImport,
    noteImport,
    itemKey: indexedKey,
    scope,
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
  const attachmentImport = await ctx.attachmentImport.prepare(file.path);
  const noteImport = await ctx.noteImport.prepare({
    client: options.client,
    sourcePath: file.path,
    settings: options.settings,
    groupIdMemo: options.groupIdMemo,
    tagMemo: options.tagMemo,
  });
  const resolvers = buildNoteResolvers(ctx, {
    attachmentImport,
    noteImport,
    settings: options.settings,
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
  });
}

/** Compose a managed update from its steps: always refresh frontmatter, and for
 *  the `full` scope also replace the managed body region. Shared by
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
  },
): Promise<UpdateResult> {
  const { context, attachmentImport, noteImport, itemKey, scope } = input;
  await refreshFrontmatter(ctx, file, { context, itemKey });
  const result =
    scope === "full"
      ? await replaceManagedBody(ctx, file, { context, itemKey })
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

/** Replace the managed body region in place, re-rendering the `content`
 *  template. The engine's transformRender wraps `content` in the managed-region
 *  markers, so the render is already wrapped. */
async function replaceManagedBody(
  ctx: NoteFeatureDeps,
  file: TFile,
  input: { context: NoteTemplateContext; itemKey: string },
): Promise<UpdateResult> {
  const { context, itemKey } = input;
  let replaced = false;
  let duplicateCount = 0;
  await ctx.app.vault.process(file, (content) => {
    // replaceManagedRegion only invokes the provider when a region exists,
    // so rendering `content` — and the attachment imports its lazy imgLink
    // closures queue as a side effect — is skipped when there is no region.
    const result = replaceManagedRegion(content, () =>
      ctx.template.render("content", context),
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
): Promise<void> {
  // Settle readiness and prepare the attachment handle before pinning the
  // client, so the lease (an auto-refresh gate) spans only the DB reads, the
  // vault writes, and the child-note import flush — not the warm-up awaits.
  await Promise.all([ctx.noteIndex.whenIndexed(), ctx.template.ready]);
  const attachmentImport = await ctx.attachmentImport.prepare(file.path);
  using lease = await ctx.db.acquireRead();
  const { context, noteImport } = await contextForIndexedKey(ctx, indexedKey, {
    client: lease.client,
    attachmentImport,
    sourcePath: file.path,
  });
  await refreshFrontmatter(ctx, file, { context, itemKey: indexedKey });
  const body = ctx.template.render("note", context);
  await ctx.app.vault.process(file, (content) => {
    const prefix = FRONTMATTER_BLOCK.exec(content)?.[0] ?? "";
    return `${prefix}${body}`;
  });

  await Promise.all([attachmentImport.flush(), noteImport.flush()]);
  logger.info("Overwrote literature note", {
    path: file.path,
    itemKey: indexedKey,
  });
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

  const [annotation] = getAnnotationsByItemId(db.client, [annotationItemId]);
  if (!annotation) return null;

  return (
    renderAnnotations(db.client, [annotation], {
      template: ctx.template,
      zoteroPref: ctx.zoteroPref,
      attachmentImport: options.attachmentImport,
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
  },
): Promise<{ context: NoteTemplateContext; noteImport: NoteImport }> {
  const settings = await ctx.settings.loaded;
  const { client, sourcePath } = options;
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
  input: { context: NoteTemplateContext; itemKey: string },
): Promise<void> {
  await ctx.app.fileManager.processFrontMatter(file, (fm) => {
    applyFrontmatter(ctx, fm, input);
  });
}

/**
 * Apply managed frontmatter into the target. Field expressions that throw are
 * skipped so the import still completes; the skipped keys are logged and
 * surfaced in one `frontmatter-eval-failed` event.
 */
function applyFrontmatter(
  ctx: OpsContext,
  fm: Record<string, unknown>,
  input: { context: NoteTemplateContext; itemKey: string },
): void {
  const { context, itemKey } = input;
  const failed: string[] = [];
  applyManagedFrontmatter(fm, context, {
    compiled: ctx.template.frontmatterFields,
    onError: (key, error) => {
      failed.push(key);
      logger.warn("Frontmatter expression failed", { key, itemKey, error });
    },
    onConflict: (key, detail) => {
      logger.warn("Skipped frontmatter append", { key, itemKey, ...detail });
    },
  });
  if (failed.length > 0) {
    ctx.events.emit("frontmatter-eval-failed", { itemKey, fields: failed });
  }
}
