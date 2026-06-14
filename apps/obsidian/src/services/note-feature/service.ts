import {
  normalizePath,
  stringifyYaml,
  TFile,
  TFolder,
  type App,
} from "obsidian";

import {
  getAnnotationsByParent,
  getAttachmentsByParents,
  getTagsByItemIDs,
  type Annotation,
  type Item,
} from "@zotlit/db";
import { type NodeDatabaseClient } from "@zotlit/db/client/node";

import { getLogger } from "@/lib/log";
import { type DatabaseService } from "@/services/database/service";
import { creatorSummary } from "@/services/item-lookup/creator-summary";
import { Service } from "@/services/service-base";
import { resolveZoteroDataDir } from "@/services/settings/schema";
import {
  type Settings,
  type SettingsService,
} from "@/services/settings/service";
import { type TemplateService } from "@/services/template/service";
import { type ZoteroPrefService } from "@/services/zotero-pref/service";

import { buildNoteContext } from "./context";
import { attachmentFileLink } from "./file-link";
import { buildFrontmatter } from "./frontmatter";
import { type NoteTemplateContext } from "./types";

const logger = getLogger("note-feature");

/** Characters Obsidian / common filesystems reject in a file name. */
const ILLEGAL_FILENAME_CHARS = /[\\/:*?"<>|]/g;

export interface NoteFeaturesDeps {
  app: App;
  template: TemplateService;
  db: DatabaseService;
  zoteroPref: ZoteroPrefService;
  settings: SettingsService;
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

  readonly ready: Promise<void> = Promise.resolve();

  constructor(deps: NoteFeaturesDeps) {
    super();
    this.#app = deps.app;
    this.#template = deps.template;
    this.#db = deps.db;
    this.#zoteroPref = deps.zoteroPref;
    this.#settings = deps.settings;
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
    const context = this.#buildContext(item, settings);

    const filename = this.#renderFilename(
      context,
      settings["template.filename"],
    );
    const folder = normalizePath(settings["note.literature-folder"]);
    const path =
      folder === "" || folder === "/"
        ? `${filename}.md`
        : `${folder}/${filename}.md`;

    await this.#ensureFolder(folder);

    const body = this.#template.render("note", context);
    const fm = buildFrontmatter(context, {
      fields: settings["note.frontmatter-fields"],
      onError: (key, error) =>
        logger.warn("Frontmatter expression failed", { key, error }),
    });
    const content = `---\n${stringifyYaml(fm)}---\n\n${body}`;

    const file = await this.#app.vault.create(path, content);
    logger.info("Created literature note", {
      path,
      itemKey: item.indexedKey,
    });
    return file;
  }

  /** Render the configured cite template for the given items. */
  renderCitation(items: readonly { citationKey: string | null }[]): string {
    return this.#template.render("cite", { items });
  }

  /**
   * Build the full note context for `item`. Synchronous DB reads via the active
   * client; throws {@link DatabaseError} if the database is not ready.
   */
  #buildContext(item: Item, settings: Readonly<Settings>): NoteTemplateContext {
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
    const tags = getTagsByItemIDs(client, [item.itemID], libraryID).map(
      (t) => t.name,
    );

    const dataDir = resolveZoteroDataDir(settings["zotero.data-dir"]);
    const baseAttachmentPath = this.#zoteroPref.baseAttachmentPath;

    return buildNoteContext({
      item,
      attachments,
      annotationsByAttachment,
      tags,
      authorsShort: creatorSummary(item),
      fileLink: (a) => attachmentFileLink(a, { dataDir, baseAttachmentPath }),
    });
  }

  #renderFilename(context: NoteTemplateContext, source: string): string {
    const raw = this.#template.renderString(source, context).trim();
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
