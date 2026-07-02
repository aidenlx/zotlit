import { withContext } from "@logtape/logtape";
import { stringifyYaml, type TFile } from "obsidian";

import {
  CollectionCache,
  getAnnotationsByItemId,
  getAnnotationsByKey,
  getItemsByKey,
  type Annotation,
  type GroupIDMemo,
  type Item,
  type ItemTag,
  type NoteTemplateContext,
  type TemplateCollection,
} from "@zotlit/db";
import { type NodeDatabaseClient } from "@zotlit/db/client/node";
import { type UpdateScope } from "@zotlit/protocol";
import {
  hasManagedRegion,
  replaceManagedRegion,
} from "@zotlit/templates/obsidian";

import { ensureParentFolder } from "@/lib/ensure-folder";
import { getLogger } from "@/lib/log";
import { BaseNotice } from "@/lib/notice";
import { isFileExistsError } from "@/lib/vault-errors";
import * as m from "@/paraglide/messages";
import { type AttachmentImport } from "@/services/attachment-import/service";
import { type DatabaseService } from "@/services/database/service";
import {
  type NoteImport,
  type PrepareNoteImportOptions,
  type RenderAnnotationParagraph,
} from "@/services/note-import/service";
import { type Settings } from "@/services/settings/schema";

import {
  buildAnnotationsTemplateData,
  buildFullContext,
  fetchItemCollections,
  fetchItemTags,
  resolveIndexedKeyLibrary,
  resolveNotePath,
  type NoteFeatureContext,
} from "./context";
import { applyManagedFrontmatter } from "./frontmatter";

const logger = getLogger("note-feature");

const FRONTMATTER_BLOCK = /^---\n[\s\S]*?\n---(?:\n+|$)/;

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
export async function createNote(
  ctx: NoteFeatureContext,
  item: Item,
  options: {
    collectionCache?: CollectionCache;
    groupIdMemo?: GroupIDMemo;
  } = {},
): Promise<TFile> {
  const collectionCache = options.collectionCache ?? new CollectionCache();
  const [settings] = await Promise.all([
    ctx.settings.loaded,
    ctx.noteIndex.ready,
  ]);
  // Pin the client across the async vault write and the child-note import flush
  // so an auto-refresh swap can't dispose it mid-operation; `lease.client` is
  // threaded through the helpers so they read one stable snapshot.
  using lease = await ctx.db.acquireRead();
  const itemTags = fetchItemTags(lease.client, item);
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
        itemTags,
        itemCollections,
        collectionCache,
        path,
        settings,
        groupIdMemo: options.groupIdMemo,
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
 * Prepare a child-note import batch for `item`'s literature note. Group and
 * library both derive from the parent lit-note item (a child note shares its
 * parent's library). The batch's client is supplied via `options.client` and
 * captured by `noteImport.prepare`; every caller holds a `db.acquireRead()`
 * lease pinning that client through flush.
 */
async function prepareNoteImport(
  ctx: NoteFeatureContext,
  item: Item,
  options: Pick<
    PrepareNoteImportOptions,
    "client" | "sourcePath" | "settings"
  > & {
    groupIdMemo?: GroupIDMemo;
  },
): Promise<NoteImport> {
  const renderAnnotationParagraph = buildAnnotationParagraphsRenderer(ctx, {
    client: options.client,
    libraryID: item.libraryID,
    settings: options.settings,
    groupIdMemo: options.groupIdMemo,
  });
  return ctx.noteImport.prepare({
    client: options.client,
    sourcePath: options.sourcePath,
    groupID: item.groupID,
    libraryID: item.libraryID,
    renderAnnotationParagraph,
    settings: options.settings,
  });
}

/**
 * Build the note-import annotation-template renderer, gated on
 * `note.import-annotations-as-template`: when the setting is off, returns
 * `undefined` so annotations stay as inline marks. When on, resolve every
 * paragraph's `data-annotation` key to its DB annotation in `libraryID` in one
 * batch and render each through the `annotation` template, returning a
 * `key → callout` map. Source of truth is the DB — a key that no longer
 * resolves is absent from the map, leaving its paragraph for inline marks. The
 * prepass drops any blank render (see {@link parseNote}), so this need not
 * pre-filter them.
 *
 * Shared by the auto path ({@link prepareNoteImport}) and the explicit/batch
 * runner so both render annotations identically.
 */
export function buildAnnotationParagraphsRenderer(
  ctx: NoteFeatureContext,
  options: {
    client: NodeDatabaseClient;
    libraryID: number;
    settings: Readonly<Settings>;
    groupIdMemo?: GroupIDMemo;
  },
): RenderAnnotationParagraph | undefined {
  if (!options.settings["note.import-annotations-as-template"])
    return undefined;
  const { client, libraryID, groupIdMemo } = options;
  return (annotationKeys, resolveLink) => {
    const annotations = getAnnotationsByKey(client, annotationKeys, libraryID);
    return renderResolvedAnnotations(ctx, {
      client,
      annotations,
      attachmentImport: { resolveLink },
      groupIdMemo,
    });
  };
}

/**
 * Inner write step for {@link createNote}, which handles path resolution and
 * collision retries before calling here.
 *
 * @throws an Obsidian vault error (e.g. a file already exists at `path`).
 */
export async function writeNewNote(
  ctx: NoteFeatureContext,
  item: Item,
  options: {
    client: NodeDatabaseClient;
    itemTags: readonly ItemTag[];
    itemCollections: readonly TemplateCollection[];
    collectionCache: CollectionCache;
    path: string;
    settings: Readonly<Settings>;
    groupIdMemo?: GroupIDMemo;
  },
): Promise<TFile> {
  const { itemTags, itemCollections, collectionCache, path, settings } =
    options;
  await ensureParentFolder(ctx.app, path);

  const attachmentImport = await ctx.attachmentImport.prepare(path);
  const noteImport = await prepareNoteImport(ctx, item, {
    client: options.client,
    sourcePath: path,
    groupIdMemo: options.groupIdMemo,
    settings,
  });
  const content = withContext({ targetNote: item.indexedKey }, () => {
    const context = buildFullContext(ctx, item, {
      client: options.client,
      itemTags,
      itemCollections,
      collectionCache,
      attachmentImport,
      noteImport,
      settings,
      sourcePath: path,
      groupIdMemo: options.groupIdMemo,
    });
    const body = ctx.template.render("note", context);
    const fm: Record<string, unknown> = {};
    applyFrontmatter(ctx, fm, context);
    return `---\n${stringifyYaml(fm)}---\n${body}`;
  });

  const file = await ctx.app.vault.create(path, content);
  await attachmentImport.flush();
  await noteImport.flush();
  logger.debug("Created literature note", { path, itemKey: item.indexedKey });
  return file;
}

export async function updateNote(
  ctx: NoteFeatureContext,
  file: TFile,
  options: { indexedKey: string; scope?: UpdateScope },
): Promise<UpdateResult> {
  const { indexedKey, scope = "full" } = options;
  // Settle readiness and prepare the attachment handle before pinning the
  // client, so the lease (an auto-refresh gate) spans only the DB reads, the
  // vault writes, and the child-note import flush — not the warm-up awaits.
  await Promise.all([ctx.noteIndex.ready, ctx.template.ready]);
  const attachmentImport = await ctx.attachmentImport.prepare(file.path);
  using lease = await ctx.db.acquireRead();
  return await withContext({ targetNote: indexedKey }, async () => {
    const { context, noteImport } = await contextForIndexedKey(
      ctx,
      indexedKey,
      {
        client: lease.client,
        attachmentImport,
        sourcePath: file.path,
      },
    );
    return applyManagedUpdate(ctx, file, {
      context,
      attachmentImport,
      noteImport,
      itemKey: indexedKey,
      scope,
    });
  });
}

/**
 * Update an existing note from an already-fetched `item` and `itemTags`. The
 * batch runner calls this to reuse the item it classified and the tags it
 * bulk-fetched, skipping the per-item resolution {@link updateNote} does via
 * `indexedKey` (re-deriving the library and re-querying the item + its tags).
 *
 * Assumes the caller has gated database, note-index, and template readiness;
 * the batch runner does so once for the whole run, so unlike {@link updateNote}
 * (via {@link contextForIndexedKey}) this does not await them itself.
 */
export async function writeNoteUpdate(
  ctx: NoteFeatureContext,
  file: TFile,
  options: {
    client: NodeDatabaseClient;
    item: Item;
    itemTags: readonly ItemTag[];
    itemCollections: readonly TemplateCollection[];
    collectionCache: CollectionCache;
    settings: Readonly<Settings>;
    scope?: UpdateScope;
    groupIdMemo?: GroupIDMemo;
  },
): Promise<UpdateResult> {
  const attachmentImport = await ctx.attachmentImport.prepare(file.path);
  const noteImport = await prepareNoteImport(ctx, options.item, {
    client: options.client,
    sourcePath: file.path,
    groupIdMemo: options.groupIdMemo,
    settings: options.settings,
  });
  return withContext({ targetNote: options.item.indexedKey }, () => {
    const context = buildFullContext(ctx, options.item, {
      client: options.client,
      itemTags: options.itemTags,
      itemCollections: options.itemCollections,
      collectionCache: options.collectionCache,
      attachmentImport,
      noteImport,
      settings: options.settings,
      sourcePath: file.path,
      groupIdMemo: options.groupIdMemo,
    });
    return applyManagedUpdate(ctx, file, {
      context,
      attachmentImport,
      noteImport,
      itemKey: options.item.indexedKey,
      scope: options.scope ?? "full",
    });
  });
}

/** Compose a managed update from its steps: always refresh frontmatter, and for
 *  the `full` scope also replace the managed body region. Shared by
 *  {@link updateNote} and {@link writeNoteUpdate}; the caller supplies the
 *  already-built context and its prepared `attachmentImport`. */
async function applyManagedUpdate(
  ctx: NoteFeatureContext,
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
  await refreshFrontmatter(ctx, file, context);
  const result =
    scope === "full"
      ? await replaceManagedBody(ctx, file, context)
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
  ctx: NoteFeatureContext,
  file: TFile,
  context: NoteTemplateContext,
): Promise<UpdateResult> {
  let replaced = false;
  let duplicateCount = 0;
  await ctx.app.vault.process(file, (content) => {
    // rendering the `content` template may queues attachment imports
    // via lazy imgLink closures, so avoiding it when there is no region.
    if (!hasManagedRegion(content)) return content;
    const region = ctx.template.render("content", context);
    const result = replaceManagedRegion(content, region);
    replaced = result.replaced;
    duplicateCount = result.duplicateCount;
    return result.content;
  });

  if (duplicateCount > 0) {
    logger.warn("Literature note has duplicate managed regions", {
      path: file.path,
      count: duplicateCount + 1,
    });
  }
  return { bodyUpdated: replaced, duplicateRegionCount: duplicateCount };
}

export async function overwriteNote(
  ctx: NoteFeatureContext,
  file: TFile,
  indexedKey: string,
): Promise<void> {
  // Settle readiness and prepare the attachment handle before pinning the
  // client, so the lease (an auto-refresh gate) spans only the DB reads, the
  // vault writes, and the child-note import flush — not the warm-up awaits.
  await Promise.all([ctx.noteIndex.ready, ctx.template.ready]);
  const attachmentImport = await ctx.attachmentImport.prepare(file.path);
  using lease = await ctx.db.acquireRead();
  await withContext({ targetNote: indexedKey }, async () => {
    const { context, noteImport } = await contextForIndexedKey(
      ctx,
      indexedKey,
      {
        client: lease.client,
        attachmentImport,
        sourcePath: file.path,
      },
    );
    await refreshFrontmatter(ctx, file, context);
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
  });
}

/**
 * Render the configured cite template for the given items.
 *
 * @param secondary - render the bare `cite2` template (narrative/in-prose,
 *   e.g. `@key`) instead of the default bracketed `cite` template (`[@key]`).
 */
export function renderCitation(
  ctx: NoteFeatureContext,
  items: readonly { citationKey: string | null }[],
  secondary = false,
): string {
  return ctx.template.render(secondary ? "cite2" : "cite", { items });
}

/**
 * Render a single annotation through the `annotation` template for the annot
 * view's drag-insert. Synchronous (so it can populate `dataTransfer` during
 * `dragstart`): requires a ready database and a pre-prepared `attachmentImport`
 * handle whose `flush()` the caller runs on drop. Only the dragged annotation's
 * template is rendered, so only its excerpt image is queued for import. Returns
 * `null` when the item or annotation can't be resolved.
 */
export function renderAnnotation(
  ctx: Omit<NoteFeatureContext, "db">,
  options: {
    db: Pick<DatabaseService, "state" | "client">;
    annotationItemId: number;
    attachmentImport: Pick<AttachmentImport, "resolveLink">;
  },
): string | null {
  const { db, annotationItemId, attachmentImport } = options;
  if (db.state !== "ready") return null;

  const [annotation] = getAnnotationsByItemId(db.client, [annotationItemId]);
  if (!annotation) return null;

  return (
    renderResolvedAnnotations(ctx, {
      client: db.client,
      annotations: [annotation],
      attachmentImport,
    }).get(annotation.key) ?? null
  );
}

/**
 * Resolve already-fetched annotations to their template data and render each
 * through the `annotation` template, returning a `key → rendered string` map.
 */
function renderResolvedAnnotations(
  ctx: Omit<NoteFeatureContext, "db">,
  options: {
    client: NodeDatabaseClient;
    annotations: readonly Annotation[];
    attachmentImport: Pick<AttachmentImport, "resolveLink">;
    groupIdMemo?: GroupIDMemo;
  },
): Map<string, string> {
  const dataByKey = buildAnnotationsTemplateData(ctx, options);
  const result = new Map<string, string>();
  for (const [key, data] of dataByKey) {
    result.set(key, ctx.template.render("annotation", data));
  }
  return result;
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
  ctx: NoteFeatureContext,
  indexedKey: string,
  options: {
    client: NodeDatabaseClient;
    attachmentImport: Pick<AttachmentImport, "resolveLink">;
    sourcePath: string;
  },
): Promise<{ context: NoteTemplateContext; noteImport: NoteImport }> {
  const settings = await ctx.settings.loaded;
  const { client, sourcePath } = options;
  const parsed = resolveIndexedKeyLibrary(client, indexedKey);
  if (!parsed) throw new Error(`Zotero item not found: ${indexedKey}`);

  const [item] = getItemsByKey(client, parsed.libraryID, [parsed.key]);
  if (!item) throw new Error(`Zotero item not found: ${indexedKey}`);
  const collectionCache = new CollectionCache();
  const itemTags = fetchItemTags(client, item);
  const itemCollections = fetchItemCollections(collectionCache, client, item);
  const noteImport = await prepareNoteImport(ctx, item, {
    client,
    sourcePath,
    settings,
  });
  const context = buildFullContext(ctx, item, {
    client,
    itemTags,
    itemCollections,
    collectionCache,
    attachmentImport: options.attachmentImport,
    noteImport,
    settings,
    sourcePath,
  });
  return { context, noteImport };
}

async function refreshFrontmatter(
  ctx: NoteFeatureContext,
  file: TFile,
  context: NoteTemplateContext,
): Promise<void> {
  await ctx.app.fileManager.processFrontMatter(file, (fm) => {
    applyFrontmatter(ctx, fm, context);
  });
}

/**
 * Apply managed frontmatter into the target. Field expressions that throw are
 * skipped so the import still completes; the skipped keys are logged and
 * surfaced in one toast.
 */
function applyFrontmatter(
  ctx: NoteFeatureContext,
  fm: Record<string, unknown>,
  context: NoteTemplateContext,
): void {
  const failed: string[] = [];
  applyManagedFrontmatter(fm, context, {
    compiled: ctx.template.frontmatterFields,
    onError: (key, error) => {
      failed.push(key);
      logger.warn("Frontmatter expression failed", { key, error });
    },
    onConflict: (key, detail) => {
      logger.warn("Skipped frontmatter append", { key, ...detail });
    },
  });
  if (failed.length > 0) {
    new BaseNotice(
      m.notice_frontmatter_eval_failed({ fields: failed.join(", ") }),
    );
  }
}
