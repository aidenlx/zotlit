import { pathToFileURL } from "node:url";
import { FileSystemAdapter, normalizePath, type App } from "obsidian";

import {
  copyAttachments,
  type AttachmentCopyItem,
  type AttachmentCopyResult,
} from "@/lib/copy-attachments";
import { ensureAttachmentFolder } from "@/lib/ensure-folder";
import { getLogger } from "@/lib/log";
import { syntheticFile } from "@/lib/markdown-link";
import { Service } from "@/services/service-base";
import { type SettingsService } from "@/services/settings/service";

const logger = getLogger("attachment-import");

export interface AttachmentImportServiceDeps {
  app: App;
  settings: SettingsService;
}

export interface AttachmentImport {
  resolveEmbed(sourcePath: string, vaultName: string): string;
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

  async prepare(notePath: string): Promise<AttachmentImport> {
    const settings = await this.#settings.loaded;
    const importEnabled = settings["attachment.import"];
    const folder = importEnabled
      ? await ensureAttachmentFolder(
          this.#app,
          settings["attachment.folder-path"],
          notePath,
        )
      : null;

    logger.debug("Prepared attachment import", {
      notePath,
      importEnabled,
      folderPath: folder?.path ?? null,
    });

    return new AttachmentImportBatch({
      app: this.#app,
      notePath,
      folderPath: folder?.path ?? null,
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
    this.#folderPath = options.folderPath;
    this.#importEnabled = options.importEnabled;
  }

  resolveEmbed(sourcePath: string, vaultName: string): string {
    if (!this.#importEnabled || this.#folderPath === null) {
      return `![](${pathToFileURL(sourcePath).href})`;
    }

    const vaultPath = normalizePath(
      this.#folderPath === "/" || this.#folderPath === ""
        ? vaultName
        : `${this.#folderPath}/${vaultName}`,
    );
    this.#items.push({
      source: sourcePath,
      dest: this.#absoluteVaultPath(vaultPath),
    });
    return `!${this.#app.fileManager.generateMarkdownLink(
      syntheticFile(vaultPath),
      this.#notePath,
    )}`;
  }

  async flush(): Promise<AttachmentCopyResult> {
    const result = await copyAttachments(this.#items);
    logger.info("Imported attachments", {
      copied: result.copied,
      skipped: result.skipped,
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
