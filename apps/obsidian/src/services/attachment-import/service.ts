import { dirname } from "node:path/posix";
import { FileSystemAdapter, normalizePath, type App } from "obsidian";

import { type TemplateLink } from "@zotlit/db";

import {
  copyAttachments,
  type AttachmentCopyItem,
  type AttachmentCopyResult,
} from "@/lib/copy-attachments";
import {
  ensureFolder,
  joinFolderPath,
  normalizeFolderPath,
  resolveAttachmentFolderPath,
} from "@/lib/ensure-folder";
import { getLogger } from "@/lib/log";
import { fileUrlLink, syntheticFile } from "@/lib/markdown-link";
import { Service } from "@/services/service-base";
import { type SettingsService } from "@/services/settings/service";

const logger = getLogger("attachment-import");

export interface AttachmentImportServiceDeps {
  app: App;
  settings: SettingsService;
}

export interface ResolveLinkOptions {
  /** Absolute on-disk path of the source image to link or copy in. */
  sourcePath: string;
  /** Desired in-vault filename for the imported copy; also the default link display text. */
  vaultName: string;
}

export interface AttachmentImport {
  /**
   * Return a {@link TemplateLink} helper — a `file://` link to the source when
   * import is disabled, or a vault link to the in-vault copy otherwise. Prefix
   * the rendered link with `!` for an embed. With import enabled the copy is
   * queued lazily, once, on the helper's first invocation, so an excerpt whose
   * link is never rendered imports nothing.
   */
  resolveLink(opts: ResolveLinkOptions): TemplateLink;
  flush(): Promise<AttachmentCopyResult>;
}

export class AttachmentImportService extends Service<void> {
  readonly #app;
  readonly #settings;

  ready: Promise<void> = Promise.resolve();

  constructor(deps: AttachmentImportServiceDeps) {
    super();
    this.#app = deps.app;
    this.#settings = deps.settings;
  }

  /**
   * @param opts.folderCache - Keyed by `dirname(notePath)`; every note in the
   *   same folder resolves to the same attachment folder, so a run-scoped
   *   cache lets a batch import skip the repeated `resolveAttachmentFolderPath`
   *   probe (async when the setting is the default "use note folder").
   */
  async prepare(
    notePath: string,
    opts?: { folderCache?: Map<string, string> },
  ): Promise<AttachmentImport> {
    const settings = await this.#settings.loaded;
    const importEnabled = settings["attachment.import"];
    let folderPath: string | null = null;
    if (importEnabled) {
      const cache = opts?.folderCache;
      const cacheKey = dirname(notePath);
      const cached = cache?.get(cacheKey);
      if (cached !== undefined) {
        folderPath = cached;
      } else {
        folderPath = await resolveAttachmentFolderPath(
          this.#app,
          settings["attachment.folder-path"],
          notePath,
        );
        cache?.set(cacheKey, folderPath);
      }
    }

    logger.debug("Prepared attachment import", {
      notePath,
      importEnabled,
      folderPath,
    });

    return new AttachmentImportBatch({
      app: this.#app,
      notePath,
      folderPath,
      importEnabled,
    });
  }
}

interface AttachmentImportBatchOptions {
  app: App;
  notePath: string;
  folderPath: string | null;
  importEnabled: boolean;
}

class AttachmentImportBatch implements AttachmentImport {
  readonly #app;
  readonly #notePath;
  readonly #folderPath;
  readonly #importEnabled;
  readonly #items: AttachmentCopyItem[] = [];

  constructor(options: AttachmentImportBatchOptions) {
    this.#app = options.app;
    this.#notePath = options.notePath;
    this.#folderPath = normalizeFolderPath(options.folderPath);
    this.#importEnabled = options.importEnabled;
  }

  resolveLink({ sourcePath, vaultName }: ResolveLinkOptions): TemplateLink {
    if (!this.#importEnabled || this.#folderPath === null) {
      return fileUrlLink(sourcePath, vaultName);
    }

    const vaultPath = normalizePath(
      joinFolderPath(this.#folderPath, vaultName),
    );
    const file = syntheticFile(vaultPath);
    // Queue the copy on first render of this link, not at resolve time, so an
    // excerpt the template never embeds imports nothing.
    let queued = false;
    // generateMarkdownLink fills the default display text from the filename per
    // the vault's wikilink / Markdown preference, so the default link is never
    // blank.
    return (alias, subpath) => {
      if (!queued) {
        queued = true;
        this.#items.push({
          source: sourcePath,
          dest: this.#absoluteVaultPath(vaultPath),
        });
      }
      return this.#app.fileManager.generateMarkdownLink(
        file,
        this.#notePath,
        subpath,
        alias,
      );
    };
  }

  async flush(): Promise<AttachmentCopyResult> {
    // Create the folder only now that a copy is actually queued; copyAttachments
    // writes straight to dest and never makes the parent.
    if (this.#items.length > 0 && this.#folderPath) {
      await ensureFolder(this.#app, this.#folderPath);
    }
    const result = await copyAttachments(this.#items);
    logger.debug("Imported attachments", {
      copied: result.copied,
      skipped: result.skipped,
      missing: result.missing,
    });
    return result;
  }

  #absoluteVaultPath(vaultPath: string): string {
    const { adapter } = this.#app.vault;
    if (!(adapter instanceof FileSystemAdapter)) {
      throw new Error("Attachment import requires a filesystem vault adapter");
    }
    return adapter.getFullPath(vaultPath);
  }
}
