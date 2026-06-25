import { dirname } from "node:path/posix";
import { stringifyYaml, type TFile } from "obsidian";

import {
  CollectionCache,
  getItemsByKey,
  type Item,
  type ItemTag,
  type NoteTemplateContext,
  type TemplateCollection,
} from "@zotlit/db";
import { type UpdateScope } from "@zotlit/protocol";
import { replaceManagedRegion } from "@zotlit/templates/obsidian";

import { ensureFolder } from "@/lib/ensure-folder";
import { getLogger } from "@/lib/log";
import { BaseNotice } from "@/lib/notice";
import * as m from "@/paraglide/messages";
import { type AttachmentImport } from "@/services/attachment-import/service";
import { type Settings } from "@/services/settings/schema";

import {
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
 * Whether `error` is Obsidian's `vault.create` rejection for an already-taken
 * path. The message is the only signal — the rejection carries no error code,
 * and the vault path cache can lag the colliding file, so it is unreliable.
 */
function isFileExistsError(error: unknown): boolean {
  return Error.isError(error) && error.message === "File already exists.";
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
export async function createNote(
  ctx: NoteFeatureContext,
  item: Item,
  options: { collectionCache?: CollectionCache } = {},
): Promise<TFile> {
  const collectionCache = options.collectionCache ?? new CollectionCache();
  const [settings] = await Promise.all([
    ctx.settings.loaded,
    ctx.noteIndex.ready,
  ]);
  const itemTags = fetchItemTags(ctx.db.client, item);
  const itemCollections = fetchItemCollections(
    collectionCache,
    ctx.db.client,
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
        itemTags,
        itemCollections,
        collectionCache,
        path,
        settings,
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
export async function writeNewNote(
  ctx: NoteFeatureContext,
  item: Item,
  options: {
    itemTags: readonly ItemTag[];
    itemCollections: readonly TemplateCollection[];
    collectionCache: CollectionCache;
    path: string;
    settings: Readonly<Settings>;
  },
): Promise<TFile> {
  const { itemTags, itemCollections, collectionCache, path, settings } =
    options;
  const dir = dirname(path);
  if (dir !== "." && dir !== "/") {
    await ensureFolder(ctx.app, dir);
  }

  const attachmentImport = await ctx.attachmentImport.prepare(path);
  const context = buildFullContext(ctx, item, {
    itemTags,
    itemCollections,
    collectionCache,
    attachmentImport,
    settings,
    sourcePath: path,
  });
  const body = ctx.template.render("note", context);
  const fm: Record<string, unknown> = {};
  applyFrontmatter(ctx, fm, context);
  const content = `---\n${stringifyYaml(fm)}---\n${body}`;

  const file = await ctx.app.vault.create(path, content);
  await attachmentImport.flush();
  logger.debug("Created literature note", { path, itemKey: item.indexedKey });
  return file;
}

export async function updateNote(
  ctx: NoteFeatureContext,
  file: TFile,
  options: { indexedKey: string; scope?: UpdateScope },
): Promise<UpdateResult> {
  const { indexedKey, scope = "full" } = options;
  const attachmentImport = await ctx.attachmentImport.prepare(file.path);
  const context = await contextForIndexedKey(ctx, indexedKey, {
    attachmentImport,
    sourcePath: file.path,
  });
  return applyManagedUpdate(ctx, file, {
    context,
    attachmentImport,
    itemKey: indexedKey,
    scope,
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
    item: Item;
    itemTags: readonly ItemTag[];
    itemCollections: readonly TemplateCollection[];
    collectionCache: CollectionCache;
    settings: Readonly<Settings>;
    scope?: UpdateScope;
  },
): Promise<UpdateResult> {
  const attachmentImport = await ctx.attachmentImport.prepare(file.path);
  const context = buildFullContext(ctx, options.item, {
    itemTags: options.itemTags,
    itemCollections: options.itemCollections,
    collectionCache: options.collectionCache,
    attachmentImport,
    settings: options.settings,
    sourcePath: file.path,
  });
  return applyManagedUpdate(ctx, file, {
    context,
    attachmentImport,
    itemKey: options.item.indexedKey,
    scope: options.scope ?? "full",
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
    itemKey: string;
    scope: UpdateScope;
  },
): Promise<UpdateResult> {
  const { context, attachmentImport, itemKey, scope } = input;
  await refreshFrontmatter(ctx, file, context);
  const result =
    scope === "full"
      ? await replaceManagedBody(ctx, file, context)
      : NO_BODY_UPDATE;
  await attachmentImport.flush();

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
  const region = ctx.template.render("content", context);
  let replaced = false;
  let duplicateCount = 0;
  await ctx.app.vault.process(file, (content) => {
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
  const attachmentImport = await ctx.attachmentImport.prepare(file.path);
  const context = await contextForIndexedKey(ctx, indexedKey, {
    attachmentImport,
    sourcePath: file.path,
  });
  await refreshFrontmatter(ctx, file, context);
  const body = ctx.template.render("note", context);
  await ctx.app.vault.process(file, (content) => {
    const prefix = FRONTMATTER_BLOCK.exec(content)?.[0] ?? "";
    return `${prefix}${body}`;
  });
  await attachmentImport.flush();
  logger.info("Overwrote literature note", {
    path: file.path,
    itemKey: indexedKey,
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
  ctx: NoteFeatureContext,
  indexedKey: string,
  options: {
    annotationKey: string;
    attachmentImport: Pick<AttachmentImport, "resolveLink">;
  },
): string | null {
  if (ctx.db.state !== "ready") return null;
  const parsed = resolveIndexedKeyLibrary(ctx.db.client, indexedKey);
  if (!parsed) return null;
  const [item] = getItemsByKey(ctx.db.client, parsed.libraryID, [parsed.key]);
  if (!item) return null;

  const { annotationKey, attachmentImport } = options;
  const collectionCache = new CollectionCache();
  const itemTags = fetchItemTags(ctx.db.client, item);
  const itemCollections = fetchItemCollections(
    collectionCache,
    ctx.db.client,
    item,
  );
  const context = buildFullContext(ctx, item, {
    itemTags,
    itemCollections,
    collectionCache,
    attachmentImport,
    settings: ctx.settings.current,
    sourcePath: "",
  });
  const annot = context.annotations.find((a) => a.key === annotationKey);
  return annot ? ctx.template.render("annotation", annot) : null;
}

async function contextForIndexedKey(
  ctx: NoteFeatureContext,
  indexedKey: string,
  options: {
    attachmentImport: Pick<AttachmentImport, "resolveLink">;
    sourcePath: string;
  },
): Promise<NoteTemplateContext> {
  // `template.ready` gates `refreshFrontmatter`, which reads
  // `template.frontmatterFields` and writes before `render()` would throw —
  // without it, an early update could strip managed frontmatter to the
  // still-empty compiled fields.
  await Promise.all([ctx.db.ready, ctx.noteIndex.ready, ctx.template.ready]);
  const settings = await ctx.settings.loaded;
  const client = ctx.db.client;
  const parsed = resolveIndexedKeyLibrary(client, indexedKey);
  if (!parsed) throw new Error(`Zotero item not found: ${indexedKey}`);

  const [item] = getItemsByKey(client, parsed.libraryID, [parsed.key]);
  if (!item) throw new Error(`Zotero item not found: ${indexedKey}`);
  const collectionCache = new CollectionCache();
  const itemTags = fetchItemTags(client, item);
  const itemCollections = fetchItemCollections(collectionCache, client, item);
  return buildFullContext(ctx, item, {
    itemTags,
    itemCollections,
    collectionCache,
    attachmentImport: options.attachmentImport,
    settings,
    sourcePath: options.sourcePath,
  });
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
