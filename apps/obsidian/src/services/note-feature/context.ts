import type { FileManager, MetadataCache, TFile, Vault } from "obsidian";

import { buildFilenameContext } from "@zotlit/db";
import type {
  CollectionCache,
  Item,
  ItemTag,
  NoteResolvers,
  TemplateCollection,
  TemplateFilenameItemData,
} from "@zotlit/db";
import type { NodeDatabaseClient } from "@zotlit/db/client/node";
import { hasSuffixMarker } from "@zotlit/templates";

import { buildAnnotationResolvers } from "@/lib/annotation-render";
import { joinFolderPath, normalizeFolderPath } from "@/lib/ensure-folder";
import { creatorSummary } from "@/lib/item-summary";
import { getLogger } from "@/lib/log";
import { syntheticFile } from "@/lib/markdown-link";
import type {
  AttachmentImport,
  AttachmentImportService,
} from "@/services/attachment-import/service";
import type { DatabaseService } from "@/services/database/service";
import type { NoteImport, NoteImporter } from "@/services/note-import/service";
import type { NoteIndex } from "@/services/note-index/service";
import { getProfileBinding } from "@/services/profile/bindings";
import type { ProfileBindingSettings } from "@/services/profile/bindings";
import type { ProfileService } from "@/services/profile/service";
import type { Settings } from "@/services/settings/schema";
import type { SettingsService } from "@/services/settings/service";
import type { TemplateService } from "@/services/template/service";
import type { ResolvedLiteratureNoteTemplate } from "@/services/template/service";
import type { ZoteroPrefService } from "@/services/zotero-pref/service";

import { resolveFreeNotePath } from "./filename";

const logger = getLogger("note-feature");

/** The vault + file-manager surface the note operations touch. */
interface NoteVaultApp {
  vault: Pick<
    Vault,
    "getAbstractFileByPath" | "getRoot" | "createFolder" | "create" | "process"
  >;
  fileManager: Pick<
    FileManager,
    "generateMarkdownLink" | "processFrontMatter" | "renameFile"
  >;
  metadataCache: Pick<MetadataCache, "getFileCache">;
}

/**
 * The injected dependency bundle for the note feature's composable functions.
 * Every member is a structural `Pick` of the full service sized to what the
 * operations touch, so {@link createNoteFeature} accepts the full services as-is
 * and tests hand-write stubs with no casts. Holds no mutable state — compiled
 * template artifacts live in {@link TemplateService}.
 */
export interface NoteFeatureDeps {
  profile: Pick<
    ProfileService,
    "ready" | "loaded" | "profiles" | "resolveProfile" | "profileOf"
  >;
  app: NoteVaultApp;
  template: Pick<
    TemplateService,
    | "ready"
    | "loaded"
    | "render"
    | "renderProfileAnnotation"
    | "renderFilename"
    | "frontmatterFields"
    | "getLiteratureNoteTemplate"
  >;
  /**
   * Lease-only. The sync `state`/`client` accessors are omitted so async
   * operations must pin a snapshot via `acquireRead()` and read through the
   * lease, rather than touching a `client` a refresh swap could close mid-read.
   * The synchronous `renderAnnotation` path takes {@link SyncRenderDeps}.
   */
  db: Pick<DatabaseService, "acquireRead">;
  noteIndex: Pick<
    NoteIndex,
    "ready" | "whenIndexed" | "getNotesByItemKey" | "getImportedNoteByNoteKey"
  >;
  zoteroPref: Pick<ZoteroPrefService, "dataDir" | "baseAttachmentPath">;
  settings: Pick<SettingsService, "current" | "loaded" | "update">;
  attachmentImport: Pick<AttachmentImportService, "prepare">;
  noteImport: Pick<NoteImporter, "prepare">;
}

/**
 * `renderAnnotation` runs synchronously during `dragstart`, so it reads a live
 * `state`/`client` snapshot off `db` in one uninterrupted tick instead of
 * awaiting a lease — no `await` boundary a refresh swap could interleave with.
 */
export type SyncRenderDeps = NoteFeatureDeps & {
  db: Pick<DatabaseService, "acquireRead" | "state" | "client">;
};

interface NoteTarget {
  path: string;
  file: TFile;
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
  ctx: NoteFeatureDeps,
  item: Item,
  options: {
    itemTags: readonly ItemTag[];
    itemCollections: readonly TemplateCollection[];
    settings: ProfileBindingSettings;
    forceSuffix?: boolean;
    document?: Pick<ResolvedLiteratureNoteTemplate, "renderFilename">;
  },
): { path: string; canSuffix: boolean } {
  const folderSetting = getProfileBinding(
    options.settings,
    "note.literature-folder",
  );
  const data = buildFilenameContext({
    item,
    tags: options.itemTags,
    collections: options.itemCollections,
    authorsShort: creatorSummary,
  });
  const rendered = options.document
    ? options.document.renderFilename(data)
    : ctx.template.renderFilename(data);
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
 * The full resolver bundle for `item`'s note context, passed to
 * `@zotlit/db`'s `fetchNoteContext`: annotation resolvers, the literature-note
 * path/link/author-summary resolvers, and `zt.notes`' child-note link mapper.
 */
export function buildNoteResolvers(
  ctx: Omit<NoteFeatureDeps, "db">,
  options: {
    attachmentImport: Pick<AttachmentImport, "decide" | "resolveLink">;
    noteImport: Pick<NoteImport, "resolveChildNote">;
    settings: ProfileBindingSettings | null;
    sourcePath: string;
  },
): NoteResolvers {
  const resolvingFallback = new Set<string>();
  const resolveTarget = (item: TemplateFilenameItemData): NoteTarget =>
    resolveNoteTarget(ctx, item, {
      settings: options.settings,
      resolvingFallback,
    });

  return {
    annotation: buildAnnotationResolvers({
      zoteroPref: ctx.zoteroPref,
      attachmentImport: options.attachmentImport,
    }),
    item: {
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
    },
    resolveChildNote: (note) => options.noteImport.resolveChildNote(note),
  };
}

/** Join a rendered relative note path under the literature-note folder. */
function literatureNotePath(folderSetting: string, rel: string): string {
  const folder = normalizeFolderPath(folderSetting);
  return joinFolderPath(folder, `${rel}.md`);
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

type NoteTargetContext = Pick<
  NoteFeatureDeps,
  "noteIndex" | "template" | "app"
>;

function resolveNoteTarget(
  ctx: NoteTargetContext,
  item: TemplateFilenameItemData,
  options: {
    settings: Readonly<Settings> | null;
    resolvingFallback: Set<string>;
  },
): NoteTarget {
  const byItemKey = ctx.noteIndex.getNotesByItemKey(item.indexedKey)[0];
  if (byItemKey) return { path: byItemKey.path, file: byItemKey };

  const { settings, resolvingFallback } = options;
  if (settings === null) {
    throw new Error("Settings are not loaded");
  }

  if (resolvingFallback.has(item.indexedKey)) {
    throw new Error("Recursive literature note path resolution");
  }
  resolvingFallback.add(item.indexedKey);
  try {
    const folderSetting = getProfileBinding(settings, "note.literature-folder");
    // A synthetic link target must be deterministic, so drop any `suffix()`
    // marker to the base name (`() => false` = never apply a random suffix).
    const rel = resolveRenderedRelPath(
      folderSetting,
      ctx.template.renderFilename(item),
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
