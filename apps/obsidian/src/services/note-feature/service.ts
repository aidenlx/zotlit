import { dirname } from "node:path/posix";
import { normalizePath, stringifyYaml, type App, type TFile } from "obsidian";

import {
  buildNoteContext,
  getAnnotationsByParent,
  getAttachmentsByParents,
  getLibraryByGroupID,
  getItemsByKey,
  getRelatedKeysByItemID,
  getTagsByItemIDs,
  parseIndexedKey,
  USER_LIBRARY_ID,
  type Annotation,
  type Item,
  type ItemTag,
  type NoteContextInput,
  type NoteTemplateContext,
  type TemplateItemData,
} from "@zotlit/db";
import { type NodeDatabaseClient } from "@zotlit/db/client/node";
import { resolveAnnotCachePath } from "@zotlit/db/path";
import {
  type CompiledFrontmatterField,
  type FrontmatterField,
} from "@zotlit/templates/frontmatter";
import { replaceManagedRegion } from "@zotlit/templates/obsidian";

import { ensureFolder } from "@/lib/ensure-folder";
import { getLogger } from "@/lib/log";
import { syntheticFile } from "@/lib/markdown-link";
import { BaseNotice } from "@/lib/notice";
import * as m from "@/paraglide/messages";
import {
  type AttachmentImport,
  type AttachmentImportService,
} from "@/services/attachment-import/service";
import { type DatabaseService } from "@/services/database/service";
import { creatorSummary } from "@/services/item-lookup/creator-summary";
import { type NoteIndex } from "@/services/note-index/service";
import { Service } from "@/services/service-base";
import { type Settings } from "@/services/settings/schema";
import { type SettingsService } from "@/services/settings/service";
import { type TemplateService } from "@/services/template/service";
import { type ZoteroPrefService } from "@/services/zotero-pref/service";

import { attachmentFileLink } from "./file-link";
import { resolveNoteRelPath } from "./filename";
import { applyManagedFrontmatter, compileFrontmatter } from "./frontmatter";

const logger = getLogger("note-feature");

const FRONTMATTER_BLOCK = /^---\n[\s\S]*?\n---(?:\n+|$)/;

export interface NoteFeaturesDeps {
  app: App;
  template: TemplateService;
  db: DatabaseService;
  noteIndex: NoteIndex;
  zoteroPref: ZoteroPrefService;
  settings: SettingsService;
  attachmentImport: AttachmentImportService;
}

/**
 * Literature-note create / update and citation rendering. Owns the runtime
 * assembly of {@link NoteTemplateContext} from DB rows plus app-layer resolvers
 * (backlinks, attachment links, frontmatter expressions).
 */
export class NoteFeatures extends Service<void> {
  readonly #app;
  readonly #template;
  readonly #db;
  readonly #noteIndex;
  readonly #zoteroPref;
  readonly #settings;
  readonly #attachmentImport;

  /** Compiled frontmatter fields, memoized by the settings array reference
   *  (which changes only when the list is mutated). */
  #lastFrontmatterFields: readonly FrontmatterField[] | null = null;
  #compiledFrontmatterFields: readonly CompiledFrontmatterField[] = [];

  readonly ready: Promise<void> = Promise.resolve();

  constructor(deps: NoteFeaturesDeps) {
    super();
    this.#app = deps.app;
    this.#template = deps.template;
    this.#db = deps.db;
    this.#noteIndex = deps.noteIndex;
    this.#zoteroPref = deps.zoteroPref;
    this.#settings = deps.settings;
    this.#attachmentImport = deps.attachmentImport;
  }

  /**
   * Create a literature note for `item`: assemble the template context, render
   * the filename + body, write the frontmatter, and create the file.
   *
   * @throws {@link DatabaseError} when the database is unavailable, or an
   *   Obsidian vault error (e.g. a file already exists at the target path).
   */
  async create(item: Item): Promise<TFile> {
    const settings = await this.#settings.loaded;
    await this.#noteIndex.ready;
    const titleContext = this.#buildContext(item, {
      attachmentImport: { resolveEmbed: () => "" },
      settings,
      sourcePath: "",
    });

    const rel = this.#renderFilename(titleContext);
    const path = literatureNotePath(settings["note.literature-folder"], rel);

    const dir = dirname(path);
    if (dir !== "." && dir !== "/") {
      await ensureFolder(this.#app, dir);
    }

    const attachmentImport = await this.#attachmentImport.prepare(path);
    const context = this.#buildContext(item, {
      attachmentImport,
      settings,
      sourcePath: path,
    });
    const body = this.#template.render("note", context);
    const fm: Record<string, unknown> = {};
    this.#applyFrontmatter(fm, context, settings);
    const content = `---\n${stringifyYaml(fm)}---\n${body}`;

    const file = await this.#app.vault.create(path, content);
    await attachmentImport.flush();
    logger.info("Created literature note", {
      path,
      itemKey: item.indexedKey,
    });
    return file;
  }

  async update(file: TFile, indexedKey: string): Promise<UpdateResult> {
    const attachmentImport = await this.#attachmentImport.prepare(file.path);
    const context = await this.#contextForIndexedKey(
      indexedKey,
      attachmentImport,
      file.path,
    );
    await this.#refreshFrontmatter(file, context);

    const region = this.#renderManagedRegion(context);
    let replaced = false;
    let duplicateCount = 0;
    await this.#app.vault.process(file, (content) => {
      const result = replaceManagedRegion(content, region);
      replaced = result.replaced;
      duplicateCount = result.duplicateCount;
      return result.content;
    });
    await attachmentImport.flush();

    if (duplicateCount > 0) {
      logger.warn("Literature note has duplicate managed regions", {
        path: file.path,
        count: duplicateCount + 1,
      });
    }
    logger.info("Updated literature note", {
      path: file.path,
      itemKey: indexedKey,
      bodyUpdated: replaced,
    });
    return { bodyUpdated: replaced, duplicateRegionCount: duplicateCount };
  }

  async overwrite(file: TFile, indexedKey: string): Promise<void> {
    const attachmentImport = await this.#attachmentImport.prepare(file.path);
    const context = await this.#contextForIndexedKey(
      indexedKey,
      attachmentImport,
      file.path,
    );
    await this.#refreshFrontmatter(file, context);
    const body = this.#template.render("note", context);
    await this.#app.vault.process(file, (content) => {
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
  renderCitation(
    items: readonly { citationKey: string | null }[],
    secondary = false,
  ): string {
    return this.#template.render(secondary ? "cite2" : "cite", { items });
  }

  /**
   * Render a single annotation through the `annotation` template for the annot
   * view's drag-insert. Synchronous (so it can populate `dataTransfer` during
   * `dragstart`): requires a ready database and a pre-prepared `attachmentImport`
   * handle whose `flush()` the caller runs on drop. Only the dragged
   * annotation's image is recorded for import. Returns `null` when the item or
   * annotation can't be resolved.
   */
  renderAnnotationForDrag(
    indexedKey: string,
    annotationKey: string,
    attachmentImport: Pick<AttachmentImport, "resolveEmbed">,
  ): string | null {
    if (this.#db.state !== "ready") return null;
    const parsed = resolveIndexedKeyLibrary(this.#db.client, indexedKey);
    if (!parsed) return null;
    const [item] = getItemsByKey(this.#db.client, parsed.libraryID, [
      parsed.key,
    ]);
    if (!item) return null;

    const context = this.#buildContext(item, {
      attachmentImport,
      settings: this.#settings.current,
      sourcePath: "",
      targetAnnotationKey: annotationKey,
    });
    const annot = context.annotations.find((a) => a.key === annotationKey);
    return annot ? this.#template.render("annotation", annot) : null;
  }

  /**
   * Build the full note context for `item`. Synchronous DB reads via the active
   * client; throws {@link DatabaseError} if the database is not ready.
   *
   * When `targetAnnotationKey` is set, only that annotation's image excerpt is
   * resolved through `attachmentImport` (so a single-annotation render records
   * one pending import); every other annotation's `imgEmbed` is `null`.
   */
  #buildContext(item: Item, options: BuildContextOptions): NoteTemplateContext {
    const client: NodeDatabaseClient = this.#db.client;
    const libraryID = item.libraryID;

    const attachments = getAttachmentsByParents(
      client,
      [item.itemID],
      libraryID,
    );
    const annotationsByAttachment = new Map<number, Annotation[]>();
    for (const attachment of attachments) {
      annotationsByAttachment.set(
        attachment.itemID,
        getAnnotationsByParent(client, attachment.itemID, libraryID),
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

    const taggedItemIDs = [item.itemID, ...annotationIDs, ...relatedItemIDs];
    const tagsByItemID = new Map<number, ItemTag[]>(
      taggedItemIDs.map((itemID) => [itemID, []]),
    );
    for (const itemTag of getTagsByItemIDs(client, taggedItemIDs, libraryID)) {
      tagsByItemID.get(itemTag.itemID)?.push(itemTag);
    }

    const dataDir = this.#zoteroPref.dataDir;
    const baseAttachmentPath = this.#zoteroPref.baseAttachmentPath;
    const groupID = parseIndexedKey(item.indexedKey)?.groupID ?? null;

    return buildNoteContext({
      item,
      attachments,
      annotationsByAttachment,
      tagsByItemID,
      relatedItems,
      authorsShort: creatorSummary,
      fileLink: (a) => attachmentFileLink(a, { dataDir, baseAttachmentPath }),
      ...this.#noteResolvers(options.settings, options.sourcePath),
      imgEmbed: (annotation) => {
        if (
          options.targetAnnotationKey != null &&
          annotation.key !== options.targetAnnotationKey
        ) {
          return null;
        }
        const cachePath = resolveAnnotCachePath(annotation, {
          dataDir,
          groupID,
        });
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

  async #contextForIndexedKey(
    indexedKey: string,
    attachmentImport: Pick<AttachmentImport, "resolveEmbed">,
    sourcePath: string,
  ): Promise<NoteTemplateContext> {
    await Promise.all([this.#db.ready, this.#noteIndex.ready]);
    const settings = await this.#settings.loaded;
    const client = this.#db.client;
    const parsed = resolveIndexedKeyLibrary(client, indexedKey);
    if (!parsed) throw new Error(`Zotero item not found: ${indexedKey}`);

    const [item] = getItemsByKey(client, parsed.libraryID, [parsed.key]);
    if (!item) throw new Error(`Zotero item not found: ${indexedKey}`);
    return this.#buildContext(item, { attachmentImport, settings, sourcePath });
  }

  #noteResolvers(
    settings: Readonly<Settings> | null,
    sourcePath: string,
  ): Pick<NoteContextInput, "notePath" | "noteLink"> {
    const resolvingFallback = new Set<string>();
    const resolveTarget = (item: TemplateItemData): NoteTarget =>
      this.#resolveNoteTarget(item, settings, resolvingFallback);

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
          return this.#app.fileManager.generateMarkdownLink(
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

  #resolveNoteTarget(
    item: TemplateItemData,
    settings: Readonly<Settings> | null,
    resolvingFallback: Set<string>,
  ): NoteTarget {
    const byItemKey = this.#noteIndex.getNotesByItemKey(item.indexedKey)[0];
    if (byItemKey) return { path: byItemKey.path, file: byItemKey };

    if (item.citationKey) {
      const byCitekey = this.#noteIndex.getNotesByCitekey(item.citationKey)[0];
      if (byCitekey) return { path: byCitekey.path, file: byCitekey };
    }

    if (settings === null) {
      throw new Error("Settings are not loaded");
    }

    if (resolvingFallback.has(item.indexedKey)) {
      throw new Error("Recursive literature note path resolution");
    }
    resolvingFallback.add(item.indexedKey);
    try {
      const rel = resolveNoteRelPath(
        this.#template.renderFilename(item).trim(),
      );
      const path = literatureNotePath(settings["note.literature-folder"], rel);
      return { path, file: syntheticFile(path) };
    } finally {
      resolvingFallback.delete(item.indexedKey);
    }
  }

  async #refreshFrontmatter(
    file: TFile,
    context: NoteTemplateContext,
  ): Promise<void> {
    const settings = await this.#settings.loaded;
    await this.#app.fileManager.processFrontMatter(file, (fm) => {
      this.#applyFrontmatter(fm, context, settings);
    });
  }

  /**
   * Apply managed frontmatter into the target. Field expressions that throw are
   * skipped so the import still completes; the skipped keys are logged and
   * surfaced in one toast.
   */
  #applyFrontmatter(
    fm: Record<string, unknown>,
    context: NoteTemplateContext,
    settings: Readonly<Settings>,
  ): void {
    const failed: string[] = [];
    applyManagedFrontmatter(fm, context, {
      compiled: this.#frontmatterFields(settings["note.frontmatter-fields"]),
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

  #frontmatterFields(
    fields: readonly FrontmatterField[],
  ): readonly CompiledFrontmatterField[] {
    if (fields !== this.#lastFrontmatterFields) {
      this.#compiledFrontmatterFields = compileFrontmatter(fields);
      this.#lastFrontmatterFields = fields;
    }
    return this.#compiledFrontmatterFields;
  }

  #renderManagedRegion(context: NoteTemplateContext): string {
    // The engine's transformRender wraps the "content" template in markers, so
    // render("content") returns the managed region already wrapped.
    return this.#template.render("content", context);
  }

  /**
   * Render the filename template into a vault-relative path (no extension).
   * `/` in the rendered name routes the note into nested subfolders under the
   * literature-note folder.
   *
   * @throws {@link EmptyFilenameError} when the rendered filename is empty.
   */
  #renderFilename(context: NoteTemplateContext): string {
    const rendered = this.#template.renderFilename(context).trim();
    return resolveNoteRelPath(rendered);
  }
}

export interface UpdateResult {
  bodyUpdated: boolean;
  duplicateRegionCount: number;
}

interface BuildContextOptions {
  attachmentImport: Pick<AttachmentImport, "resolveEmbed">;
  settings: Readonly<Settings> | null;
  sourcePath: string;
  targetAnnotationKey?: string;
}

interface NoteTarget {
  path: string;
  file: TFile;
}

function literatureNotePath(folderSetting: string, rel: string): string {
  const folder = normalizePath(folderSetting);
  return folder === "" || folder === "/" ? `${rel}.md` : `${folder}/${rel}.md`;
}

function resolveIndexedKeyLibrary(
  client: NodeDatabaseClient,
  indexedKey: string,
): { key: string; libraryID: number } | null {
  const parsed = parseIndexedKey(indexedKey);
  if (!parsed) return null;
  const { key, groupID } = parsed;
  if (groupID == null) return { key, libraryID: USER_LIBRARY_ID };
  const library = getLibraryByGroupID(client, groupID);
  if (!library) return null;
  return {
    key,
    libraryID: library.libraryID,
  };
}
