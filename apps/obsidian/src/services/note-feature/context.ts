import { normalizePath, type App, type TFile } from "obsidian";

import {
  buildFilenameContext,
  buildNoteContext,
  getAnnotationsByParent,
  getAttachmentsByParents,
  getItemsByKey,
  getLibraryByGroupID,
  getRelatedKeysByItemID,
  getTagsByItemIDs,
  parseIndexedKey,
  USER_LIBRARY_ID,
  type Annotation,
  type Item,
  type ItemTag,
  type CollectionCache,
  type NoteContextInput,
  type NoteTemplateContext,
  type TemplateCollection,
  type TemplateItemData,
} from "@zotlit/db";
import { type NodeDatabaseClient } from "@zotlit/db/client/node";
import { resolveAnnotCachePath } from "@zotlit/db/path";
import { hasSuffixMarker } from "@zotlit/templates";

import { getLogger } from "@/lib/log";
import { syntheticFile } from "@/lib/markdown-link";
import {
  type AttachmentImport,
  type AttachmentImportService,
} from "@/services/attachment-import/service";
import { type DatabaseService } from "@/services/database/service";
import { creatorSummary } from "@/services/item-lookup/creator-summary";
import { type NoteIndex } from "@/services/note-index/service";
import { type Settings } from "@/services/settings/schema";
import { type SettingsService } from "@/services/settings/service";
import { type TemplateService } from "@/services/template/service";
import { type ZoteroPrefService } from "@/services/zotero-pref/service";

import { attachmentFileLink } from "./file-link";
import { resolveAvailableRelPath } from "./filename";

const logger = getLogger("note-feature");

/**
 * The injected dependency bundle for the note feature's composable functions.
 * Holds no mutable state — compiled template artifacts live in
 * {@link TemplateService}; every function here takes the rows it needs as args.
 */
export interface NoteFeatureContext {
  app: App;
  template: TemplateService;
  db: DatabaseService;
  noteIndex: NoteIndex;
  zoteroPref: ZoteroPrefService;
  settings: SettingsService;
  attachmentImport: AttachmentImportService;
}

interface BuildFullContextOptions {
  /** The item's own tags, fetched once by the caller (see {@link fetchItemTags}). */
  itemTags: readonly ItemTag[];
  /** The item's own collections, fetched once by the caller (see {@link fetchItemCollections}). */
  itemCollections: readonly TemplateCollection[];
  /** Shared per-batch memo resolving related items' collection paths. */
  collectionCache: CollectionCache;
  attachmentImport: Pick<AttachmentImport, "resolveEmbed">;
  settings: Readonly<Settings> | null;
  sourcePath: string;
  targetAnnotationKey?: string;
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
 * related-item tags are queried here. Synchronous DB reads via the active
 * client; throws {@link DatabaseError} if the database is not ready.
 *
 * When `targetAnnotationKey` is set, only that annotation's image excerpt is
 * resolved through `attachmentImport`; every other annotation's `imgEmbed` is
 * `null`.
 */
export function buildFullContext(
  ctx: NoteFeatureContext,
  item: Item,
  options: BuildFullContextOptions,
): NoteTemplateContext {
  const client = ctx.db.client;
  const libraryID = item.libraryID;

  const attachments = getAttachmentsByParents(client, [item.itemID]);
  const annotationsByAttachment = new Map<number, Annotation[]>();
  for (const attachment of attachments) {
    annotationsByAttachment.set(
      attachment.itemID,
      getAnnotationsByParent(client, attachment.itemID),
    );
  }
  const annotationIDs = [...annotationsByAttachment.values()].flatMap(
    (annotations) => annotations.map((annotation) => annotation.itemID),
  );

  const relatedItems = getItemsByKey(
    client,
    libraryID,
    getRelatedKeysByItemID(client, item.itemID),
  );
  const relatedItemIDs = relatedItems.map((related) => related.itemID);

  const extraIDs = [...annotationIDs, ...relatedItemIDs];
  const tagsByItemID = new Map<number, ItemTag[]>();
  tagsByItemID.set(item.itemID, [...options.itemTags]);
  for (const id of extraIDs) tagsByItemID.set(id, []);
  if (extraIDs.length > 0) {
    for (const itemTag of getTagsByItemIDs(client, extraIDs)) {
      tagsByItemID.get(itemTag.itemID)?.push(itemTag);
    }
  }

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

  const dataDir = ctx.zoteroPref.dataDir;
  const baseAttachmentPath = ctx.zoteroPref.baseAttachmentPath;
  const groupID = parseIndexedKey(item.indexedKey)?.groupID ?? null;

  return buildNoteContext({
    item,
    attachments,
    annotationsByAttachment,
    tagsByItemID,
    collectionsByItemID,
    relatedItems,
    authorsShort: creatorSummary,
    fileLink: (a) => attachmentFileLink(a, { dataDir, baseAttachmentPath }),
    ...noteResolvers(ctx, options.settings, options.sourcePath),
    imgEmbed: (annotation) => {
      if (
        options.targetAnnotationKey != null &&
        annotation.key !== options.targetAnnotationKey
      ) {
        return null;
      }
      const cachePath = resolveAnnotCachePath(annotation, { dataDir, groupID });
      return (
        cachePath &&
        options.attachmentImport.resolveEmbed(
          cachePath,
          `${annotation.key}.png`,
        )
      );
    },
  });
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
  const folder = normalizePath(folderSetting);
  return folder === "" || folder === "/" ? `${rel}.md` : `${folder}/${rel}.md`;
}

function resolveRenderedRelPath(
  folderSetting: string,
  rendered: string,
  options: { exists: (path: string) => boolean; forceSuffix?: boolean },
): string {
  return resolveAvailableRelPath(
    rendered,
    (rel) => options.exists(literatureNotePath(folderSetting, rel)),
    options.forceSuffix,
  );
}

function noteResolvers(
  ctx: NoteFeatureContext,
  settings: Readonly<Settings> | null,
  sourcePath: string,
): Pick<NoteContextInput, "notePath" | "noteLink"> {
  const resolvingFallback = new Set<string>();
  const resolveTarget = (item: TemplateItemData): NoteTarget =>
    resolveNoteTarget(ctx, item, { settings, resolvingFallback });

  return {
    notePath: (item) => {
      try {
        return resolveTarget(item).path;
      } catch (error) {
        logger.warn("Failed to resolve literature note path", {
          itemKey: item.indexedKey,
          error,
        });
        return "";
      }
    },
    noteLink: (item, alias) => {
      try {
        const target = resolveTarget(item);
        return ctx.app.fileManager.generateMarkdownLink(
          target.file,
          sourcePath,
          undefined,
          alias,
        );
      } catch (error) {
        logger.warn("Failed to resolve literature note link", {
          itemKey: item.indexedKey,
          error,
        });
        return "";
      }
    },
  };
}

function resolveNoteTarget(
  ctx: NoteFeatureContext,
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
