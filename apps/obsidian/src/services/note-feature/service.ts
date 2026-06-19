import {
  normalizePath,
  stringifyYaml,
  TFile,
  TFolder,
  type App,
} from "obsidian";

import {
  buildNoteContext,
  getAnnotationsByParent,
  getAttachmentsByParents,
  getLibraryByGroupID,
  getItemsByKey,
  getTagsByItemIDs,
  parseIndexedKey,
  USER_LIBRARY_ID,
  type Annotation,
  type Item,
  type ItemTag,
  type NoteTemplateContext,
} from "@zotlit/db";
import { type NodeDatabaseClient } from "@zotlit/db/client/node";
import { resolveAnnotCachePath } from "@zotlit/db/path";
import {
  type CompiledFrontmatterField,
  type FrontmatterField,
} from "@zotlit/templates/frontmatter";
import { replaceManagedRegion } from "@zotlit/templates/obsidian";

import { getLogger } from "@/lib/log";
import { BaseNotice } from "@/lib/notice";
import * as m from "@/paraglide/messages";
import {
  type AttachmentImport,
  type AttachmentImportService,
} from "@/services/attachment-import/service";
import { type DatabaseService } from "@/services/database/service";
import { creatorSummary } from "@/services/item-lookup/creator-summary";
import { Service } from "@/services/service-base";
import { type Settings } from "@/services/settings/schema";
import { type SettingsService } from "@/services/settings/service";
import { type TemplateService } from "@/services/template/service";
import { type ZoteroPrefService } from "@/services/zotero-pref/service";

import { attachmentFileLink } from "./file-link";
import {
  buildFrontmatter,
  compileFrontmatter,
  mergeManagedFrontmatter,
} from "./frontmatter";

const logger = getLogger("note-feature");

/** Characters Obsidian / common filesystems reject in a file name. */
const ILLEGAL_FILENAME_CHARS = /[\\/:*?"<>|]/g;
const FRONTMATTER_BLOCK = /^---\n[\s\S]*?\n---(?:\n+|$)/;

export interface NoteFeaturesDeps {
  app: App;
  template: TemplateService;
  db: DatabaseService;
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
    const titleContext = this.#buildContext(item, {
      resolveEmbed: () => "",
    });

    const filename = this.#renderFilename(titleContext);
    const folder = normalizePath(settings["note.literature-folder"]);
    const path =
      folder === "" || folder === "/"
        ? `${filename}.md`
        : `${folder}/${filename}.md`;

    await this.#ensureFolder(folder);

    const attachmentImport = await this.#attachmentImport.prepare(path);
    const context = this.#buildContext(item, attachmentImport);
    const body = this.#template.render("note", context);
    const fm = this.#buildFrontmatter(context, settings);
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

    const context = this.#buildContext(item, attachmentImport, annotationKey);
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
  #buildContext(
    item: Item,
    attachmentImport: Pick<AttachmentImport, "resolveEmbed">,
    targetAnnotationKey?: string,
  ): NoteTemplateContext {
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
    const tagsByItemID = new Map<number, ItemTag[]>(
      [item.itemID, ...annotationIDs].map((itemID) => [itemID, []]),
    );
    for (const itemTag of getTagsByItemIDs(
      client,
      [item.itemID, ...annotationIDs],
      libraryID,
    )) {
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
      authorsShort: creatorSummary(item),
      fileLink: (a) => attachmentFileLink(a, { dataDir, baseAttachmentPath }),
      imgEmbed: (annotation) => {
        if (
          targetAnnotationKey != null &&
          annotation.key !== targetAnnotationKey
        ) {
          return null;
        }
        const cachePath = resolveAnnotCachePath(annotation, {
          dataDir,
          groupID,
        });
        return (
          cachePath &&
          attachmentImport.resolveEmbed(cachePath, `${annotation.key}.png`)
        );
      },
    });
  }

  async #contextForIndexedKey(
    indexedKey: string,
    attachmentImport: Pick<AttachmentImport, "resolveEmbed">,
  ): Promise<NoteTemplateContext> {
    await this.#db.ready;
    const client = this.#db.client;
    const parsed = resolveIndexedKeyLibrary(client, indexedKey);
    if (!parsed) throw new Error(`Zotero item not found: ${indexedKey}`);

    const [item] = getItemsByKey(client, parsed.libraryID, [parsed.key]);
    if (!item) throw new Error(`Zotero item not found: ${indexedKey}`);
    return this.#buildContext(item, attachmentImport);
  }

  async #refreshFrontmatter(
    file: TFile,
    context: NoteTemplateContext,
  ): Promise<void> {
    const settings = await this.#settings.loaded;
    const managed = this.#buildFrontmatter(context, settings);
    await this.#app.fileManager.processFrontMatter(file, (fm) => {
      mergeManagedFrontmatter(fm, managed);
    });
  }

  /**
   * Build the managed frontmatter record. Field expressions that throw are
   * skipped so the import still completes; the skipped keys are logged and
   * surfaced in one toast.
   */
  #buildFrontmatter(
    context: NoteTemplateContext,
    settings: Readonly<Settings>,
  ): Record<string, unknown> {
    const failed: string[] = [];
    const fm = buildFrontmatter(context, {
      compiled: this.#frontmatterFields(settings["note.frontmatter-fields"]),
      onError: (key, error) => {
        failed.push(key);
        logger.warn("Frontmatter expression failed", { key, error });
      },
    });
    if (failed.length > 0) {
      new BaseNotice(
        m.notice_frontmatter_eval_failed({ fields: failed.join(", ") }),
      );
    }
    return fm;
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

  #renderFilename(context: NoteTemplateContext): string {
    const raw = this.#template.renderFilename(context).trim();
    const sanitized = raw.replace(ILLEGAL_FILENAME_CHARS, "_").trim();
    return sanitized || context.key;
  }

  async #ensureFolder(folder: string): Promise<void> {
    if (folder === "" || folder === "/") return;
    const existing = this.#app.vault.getAbstractFileByPath(folder);
    if (existing instanceof TFolder) return;
    if (existing instanceof TFile) {
      throw new Error(
        `Cannot create literature folder; a file exists at "${folder}"`,
      );
    }
    await this.#app.vault.createFolder(folder);
  }
}

export interface UpdateResult {
  bodyUpdated: boolean;
  duplicateRegionCount: number;
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
