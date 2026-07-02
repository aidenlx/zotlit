import { distinct } from "@std/collections";
import { type App, type TFile } from "obsidian";

import {
  annotationToTemplateData,
  attachmentToTemplateData,
  buildFilenameContext,
  buildNoteContext,
  getAnnotationsByParent,
  getAttachmentByItemId,
  getAttachmentsByParents,
  getChildNotes,
  getItemsByID,
  getItemsByKey,
  getLibraryByGroupID,
  getRelatedKeysByItemID,
  getTagsByItemIDs,
  itemToTemplateBaseData,
  parseIndexedKey,
  USER_LIBRARY_ID,
  type Annotation,
  type Attachment,
  type GroupIDMemo,
  type Item,
  type ItemTag,
  type CollectionCache,
  type NoteContextInput,
  type NoteTemplateContext,
  type TemplateAnnotation,
  type TemplateAttachment,
  type TemplateCollection,
  type TemplateItemData,
  type TemplateParentItemData,
} from "@zotlit/db";
import { type NodeDatabaseClient } from "@zotlit/db/client/node";
import { attachmentAbsPath, resolveAnnotCachePath } from "@zotlit/db/path";
import { hasSuffixMarker } from "@zotlit/templates";

import { normalizeFolderPath } from "@/lib/ensure-folder";
import { getLogger } from "@/lib/log";
import { syntheticFile } from "@/lib/markdown-link";
import {
  commentToMarkdown,
  createCommentTurndown,
} from "@/lib/turndown/comment";
import {
  type AttachmentImport,
  type AttachmentImportService,
} from "@/services/attachment-import/service";
import { type DatabaseService } from "@/services/database/service";
import { creatorSummary } from "@/services/item-lookup/creator-summary";
import {
  type NoteImport,
  type NoteImportService,
} from "@/services/note-import/service";
import { type NoteIndex } from "@/services/note-index/service";
import { type Settings } from "@/services/settings/schema";
import { type SettingsService } from "@/services/settings/service";
import { type TemplateService } from "@/services/template/service";
import { type ZoteroPrefService } from "@/services/zotero-pref/service";

import { attachmentFileLink } from "./file-link";
import { resolveFreeNotePath } from "./filename";

const logger = getLogger("note-feature");

/**
 * The injected dependency bundle for the note feature's composable functions.
 * Holds no mutable state — compiled template artifacts live in
 * {@link TemplateService}; every function here takes the rows it needs as args.
 */
export interface NoteFeatureContext {
  app: App;
  template: TemplateService;
  /**
   * Lease-only database access: the sync `client`/`state` accessors are omitted
   * so callers must pin a snapshot via `acquireRead()` and thread its client.
   */
  db: Pick<DatabaseService, "acquireRead" | "ready">;
  noteIndex: NoteIndex;
  zoteroPref: ZoteroPrefService;
  settings: SettingsService;
  attachmentImport: AttachmentImportService;
  noteImport: NoteImportService;
}

interface BuildFullContextOptions {
  client: NodeDatabaseClient;
  /** The item's own tags, fetched once by the caller (see {@link fetchItemTags}). */
  itemTags: readonly ItemTag[];
  /** The item's own collections, fetched once by the caller (see {@link fetchItemCollections}). */
  itemCollections: readonly TemplateCollection[];
  /** Shared per-batch memo resolving related items' collection paths. */
  collectionCache: CollectionCache;
  attachmentImport: Pick<AttachmentImport, "resolveLink">;
  /** Resolves `zt.notes` and queues child-note imports. */
  noteImport: Pick<NoteImport, "resolveChildNote">;
  settings: Readonly<Settings> | null;
  sourcePath: string;
  /** Shared `libraryID → groupID` cache; pass from a batch to resolve each library once. */
  groupIdMemo?: GroupIDMemo;
}

/** The annotation-drag context's reads: attachments + their annotations. */
interface AnnotationReads {
  attachments: Attachment[];
  annotationsByAttachment: Map<number, Annotation[]>;
  /** Flat itemIDs of every annotation, for a single tag fetch. */
  annotationIDs: number[];
}

interface NoteTarget {
  path: string;
  file: TFile;
}

/** Fetch one item's tags — the only DB read the filename path needs. */
export function fetchItemTags(
  client: NodeDatabaseClient,
  item: Pick<Item, "itemID">,
): ItemTag[] {
  return getTagsByItemIDs(client, [item.itemID]);
}

export function fetchItemCollections(
  cache: CollectionCache,
  client: NodeDatabaseClient,
  item: Pick<Item, "itemID" | "libraryID">,
): TemplateCollection[] {
  return (
    cache.byItemIDs(client, item.libraryID, [item.itemID]).get(item.itemID) ??
    []
  );
}

/**
 * No DB reads — `itemTags` are passed in. `canSuffix` in the return tells the
 * caller whether a retry with `forceSuffix` can disambiguate a collision.
 *
 * @throws {@link EmptyFilenameError} when the rendered filename is empty.
 */
export function resolveNotePath(
  ctx: NoteFeatureContext,
  item: Item,
  options: {
    itemTags: readonly ItemTag[];
    itemCollections: readonly TemplateCollection[];
    settings: Readonly<Settings>;
    forceSuffix?: boolean;
  },
): { path: string; canSuffix: boolean } {
  const folderSetting = options.settings["note.literature-folder"];
  const data = buildFilenameContext({
    item,
    tags: options.itemTags,
    collections: options.itemCollections,
  });
  const rendered = ctx.template.renderFilename(data).trim();
  const rel = resolveRenderedRelPath(folderSetting, rendered, {
    exists: (path) => ctx.app.vault.getAbstractFileByPath(path) !== null,
    forceSuffix: options.forceSuffix,
  });
  return {
    path: literatureNotePath(folderSetting, rel),
    canSuffix: hasSuffixMarker(rendered),
  };
}

/**
 * Build the full {@link NoteTemplateContext} for `item`. `itemTags` are passed
 * in (so the item's tags are fetched once by the caller); only annotation and
 * related-item tags are queried here. Synchronous DB reads via the caller-
 * supplied `options.client`, which the caller pins for the call's duration.
 *
 * Each annotation's `imgLink` queues its excerpt copy lazily, on first render
 * through `attachmentImport`, so an excerpt the template never embeds imports
 * nothing.
 */
export function buildFullContext(
  ctx: Omit<NoteFeatureContext, "db">,
  item: Item,
  options: BuildFullContextOptions,
): NoteTemplateContext {
  const client = options.client;
  const libraryID = item.libraryID;

  const memo = options.groupIdMemo;
  const { attachments, annotationsByAttachment, annotationIDs } =
    fetchAnnotations(client, item.itemID, { memo });

  const relatedItems = getItemsByKey(
    client,
    libraryID,
    getRelatedKeysByItemID(client, item.itemID),
  );
  const relatedItemIDs = relatedItems.map((related) => related.itemID);

  // The item's own tags arrive pre-fetched on `options`; query only the rest.
  const extraIDs = [...annotationIDs, ...relatedItemIDs];
  const tagsByItemID = groupTagsByItemIDs(client, extraIDs);
  tagsByItemID.set(item.itemID, [...options.itemTags]);

  // Collections resolve for the main item + related items only — annotations
  // are never collection members. Related items share the item's library.
  const collectionsByItemID = new Map<number, readonly TemplateCollection[]>([
    [item.itemID, options.itemCollections],
  ]);
  if (relatedItemIDs.length > 0) {
    for (const [id, collections] of options.collectionCache.byItemIDs(
      client,
      libraryID,
      relatedItemIDs,
    )) {
      collectionsByItemID.set(id, collections);
    }
  }

  // `zt.notes` lists eagerly; the import work it triggers stays lazy (queued on
  // the link's first render).
  const childNotes = getChildNotes(client, item.itemID, { memo });

  return buildNoteContext({
    item,
    attachments,
    annotationsByAttachment,
    tagsByItemID,
    collectionsByItemID,
    relatedItems,
    childNotes,
    resolveChildNote: (note) => options.noteImport.resolveChildNote(note),
    ...buildContextResolvers(ctx, item, options),
  });
}

interface ContextResolversOptions {
  attachmentImport: Pick<AttachmentImport, "resolveLink">;
  settings: Readonly<Settings> | null;
  sourcePath: string;
}

/**
 * Resolvers for attachment file paths and annotation rendering (comment
 * conversion, excerpt images). Shared by both the full note context
 * ({@link buildContextResolvers}) and the single-annotation drag path
 * ({@link renderAnnotation}).
 */
function buildAnnotationResolvers(
  ctx: Pick<NoteFeatureContext, "zoteroPref">,
  options: { attachmentImport: Pick<AttachmentImport, "resolveLink"> },
): Pick<
  NoteContextInput,
  "commentToMarkdown" | "annotationImageLink" | "filePath" | "fileLink"
> {
  const dataDir = ctx.zoteroPref.dataDir;
  const baseAttachmentPath = ctx.zoteroPref.baseAttachmentPath;
  const { attachmentImport } = options;
  let commentTurndown: ReturnType<typeof createCommentTurndown> | null = null;

  return {
    filePath: (a) => attachmentAbsPath(a, { dataDir, baseAttachmentPath }),
    fileLink: (a, page) =>
      attachmentFileLink(a, { dataDir, baseAttachmentPath }, page),
    commentToMarkdown: (html) => {
      commentTurndown ??= createCommentTurndown(TurndownService);
      return commentToMarkdown(commentTurndown, html);
    },
    annotationImageLink: (annotation) => {
      const cachePath = resolveAnnotCachePath(annotation, {
        dataDir,
        groupID: annotation.groupID,
      });
      if (cachePath == null) return null;
      return attachmentImport.resolveLink({
        sourcePath: cachePath,
        vaultName: `${annotation.key}.png`,
      });
    },
  };
}

/** Read an item's attachments and their annotations in display order. */
function fetchAnnotations(
  client: NodeDatabaseClient,
  itemID: number,
  opts?: { memo?: GroupIDMemo },
): AnnotationReads {
  const attachments = getAttachmentsByParents(client, [itemID], opts);
  const annotationsByAttachment = new Map<number, Annotation[]>();
  for (const attachment of attachments) {
    annotationsByAttachment.set(
      attachment.itemID,
      getAnnotationsByParent(client, attachment.itemID, opts),
    );
  }
  const annotationIDs = [...annotationsByAttachment.values()].flatMap(
    (annotations) => annotations.map((annotation) => annotation.itemID),
  );
  return { attachments, annotationsByAttachment, annotationIDs };
}

/** Query the tags of `ids` and bucket them into a map keyed by item ID. */
function groupTagsByItemIDs(
  client: NodeDatabaseClient,
  ids: number[],
): Map<number, ItemTag[]> {
  return Map.groupBy(getTagsByItemIDs(client, ids), (tag) => tag.itemID);
}

/**
 * The resolver bundle for {@link buildFullContext}: annotation resolvers plus
 * author summary and literature-note path/link.
 */
function buildContextResolvers(
  ctx: Omit<NoteFeatureContext, "db">,
  item: Item,
  options: ContextResolversOptions,
): Pick<
  NoteContextInput,
  | "authorsShort"
  | "filePath"
  | "fileLink"
  | "commentToMarkdown"
  | "notePath"
  | "noteLink"
  | "annotationImageLink"
> {
  const annotResolvers = buildAnnotationResolvers(ctx, {
    attachmentImport: options.attachmentImport,
  });

  const resolvingFallback = new Set<string>();
  const resolveTarget = (item: TemplateItemData): NoteTarget =>
    resolveNoteTarget(ctx, item, {
      settings: options.settings,
      resolvingFallback,
    });

  return {
    ...annotResolvers,
    authorsShort: creatorSummary,
    notePath: (item) => {
      try {
        return resolveTarget(item).path;
      } catch (error) {
        logger.error("Failed to resolve literature note path", {
          itemKey: item.indexedKey,
          error,
        });
        return null;
      }
    },
    noteLink: (item, alias, subpath) => {
      try {
        const target = resolveTarget(item);
        return ctx.app.fileManager.generateMarkdownLink(
          target.file,
          options.sourcePath,
          subpath,
          alias,
        );
      } catch (error) {
        logger.error("Failed to resolve literature note link", {
          itemKey: item.indexedKey,
          error,
        });
        return null;
      }
    },
  };
}

/** Resolve the active library for an `indexedKey`, or `null` when unresolvable. */
export function resolveIndexedKeyLibrary(
  client: NodeDatabaseClient,
  indexedKey: string,
): { key: string; libraryID: number } | null {
  const parsed = parseIndexedKey(indexedKey);
  if (!parsed) return null;
  const { key, groupID } = parsed;
  if (groupID == null) return { key, libraryID: USER_LIBRARY_ID };
  const library = getLibraryByGroupID(client, groupID);
  if (!library) return null;
  return { key, libraryID: library.libraryID };
}

/** Join a rendered relative note path under the literature-note folder. */
export function literatureNotePath(folderSetting: string, rel: string): string {
  const folder = normalizeFolderPath(folderSetting);
  return folder === "/" ? `${rel}.md` : `${folder}/${rel}.md`;
}

function resolveRenderedRelPath(
  folderSetting: string,
  rendered: string,
  options: { exists: (path: string) => boolean; forceSuffix?: boolean },
): string {
  return resolveFreeNotePath(
    rendered,
    (rel) => options.exists(literatureNotePath(folderSetting, rel)),
    options.forceSuffix,
  );
}

type NoteResolversContext = Pick<
  NoteFeatureContext,
  "noteIndex" | "template" | "app"
>;

function resolveNoteTarget(
  ctx: NoteResolversContext,
  item: TemplateItemData,
  options: {
    settings: Readonly<Settings> | null;
    resolvingFallback: Set<string>;
  },
): NoteTarget {
  const byItemKey = ctx.noteIndex.getNotesByItemKey(item.indexedKey)[0];
  if (byItemKey) return { path: byItemKey.path, file: byItemKey };

  if (item.citationKey) {
    const byCitekey = ctx.noteIndex.getNotesByCitekey(item.citationKey)[0];
    if (byCitekey) return { path: byCitekey.path, file: byCitekey };
  }

  const { settings, resolvingFallback } = options;
  if (settings === null) {
    throw new Error("Settings are not loaded");
  }

  if (resolvingFallback.has(item.indexedKey)) {
    throw new Error("Recursive literature note path resolution");
  }
  resolvingFallback.add(item.indexedKey);
  try {
    const folderSetting = settings["note.literature-folder"];
    // A synthetic link target must be deterministic, so drop any `suffix()`
    // marker to the base name (`() => false` = never apply a random suffix).
    const rel = resolveRenderedRelPath(
      folderSetting,
      ctx.template.renderFilename(item).trim(),
      { exists: () => false },
    );
    const path = literatureNotePath(folderSetting, rel);
    // This item has no indexed note (checked above), so an occupant at the
    // base path belongs to a different item. The real note's random `suffix()`
    // can't be predicted here, so linking to the occupant would point at the
    // wrong item — surface no target instead.
    if (ctx.app.vault.getAbstractFileByPath(path) !== null) {
      throw new Error(
        `Cannot resolve a synthetic note path: ${path} is occupied by another note`,
      );
    }
    return { path, file: syntheticFile(path) };
  } finally {
    resolvingFallback.delete(item.indexedKey);
  }
}

/** A parent PDF's reusable template shape, built once per attachment and shared
 *  by every annotation off it. */
interface ParentBundle {
  attachment: Attachment;
  tplAttachment: TemplateAttachment;
  parentItem: TemplateParentItemData;
}

/**
 * Map already-resolved {@link Annotation}s to their {@link TemplateAnnotation}s,
 * keyed by annotation key. Annotations sharing a parent PDF read its attachment
 * row, parent item, and tags once: distinct parents are batched, and each
 * parent's template bundle is reused across its annotations. An annotation whose
 * attachment or parent item is unresolvable is absent from the result.
 *
 * Shared by the drag-insert path ({@link renderAnnotation}, one annotation by
 * item id) and note import's annotation-template prepass (many, by key).
 */
export function buildAnnotationsTemplateData(
  ctx: Omit<NoteFeatureContext, "db">,
  options: {
    client: NodeDatabaseClient;
    annotations: readonly Annotation[];
    attachmentImport: Pick<AttachmentImport, "resolveLink">;
    groupIdMemo?: GroupIDMemo;
  },
): Map<string, TemplateAnnotation> {
  const { client, annotations, attachmentImport, groupIdMemo } = options;
  const result = new Map<string, TemplateAnnotation>();
  if (annotations.length === 0) return result;

  const memo = { memo: groupIdMemo };
  const resolvers = buildAnnotationResolvers(ctx, { attachmentImport });

  const attachments: Attachment[] = [];
  for (const itemID of distinct(annotations.map((a) => a.parentItemID))) {
    const attachment = getAttachmentByItemId(client, itemID, memo);
    if (attachment) attachments.push(attachment);
  }

  const parentIDs = distinct(attachments.map((a) => a.parentItemID));
  const parentItemsByID = new Map(
    getItemsByID(client, parentIDs, memo).map((item) => [item.itemID, item]),
  );

  const tagsByItemID = groupTagsByItemIDs(client, [
    ...annotations.map((a) => a.itemID),
    ...parentIDs,
  ]);

  // Keyed by attachment itemID — equal to each annotation's `parentItemID`.
  const bundleByAttachment = new Map<number, ParentBundle>();
  for (const attachment of attachments) {
    const parentItemData = parentItemsByID.get(attachment.parentItemID);
    if (!parentItemData) continue;
    bundleByAttachment.set(attachment.itemID, {
      attachment,
      parentItem: itemToTemplateBaseData({
        item: parentItemData,
        tags: tagsByItemID.get(parentItemData.itemID) ?? [],
      }),
      tplAttachment: {
        ...attachmentToTemplateData(attachment),
        filePath: resolvers.filePath(attachment),
        fileLink: resolvers.fileLink(attachment),
      },
    });
  }

  for (const annotation of annotations) {
    const bundle = bundleByAttachment.get(annotation.parentItemID);
    if (!bundle) continue;
    result.set(
      annotation.key,
      annotationToTemplateData({
        annotation,
        tags: tagsByItemID.get(annotation.itemID) ?? [],
        getParentAttachment: () => bundle.tplAttachment,
        getParentItem: () => bundle.parentItem,
        commentToMarkdown: resolvers.commentToMarkdown,
        annotationImageLink: resolvers.annotationImageLink,
        fileLink: (page) => resolvers.fileLink(bundle.attachment, page),
      }),
    );
  }
  return result;
}
