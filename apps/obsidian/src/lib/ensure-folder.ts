import { dirname } from "node:path/posix";
import { normalizePath, TFile, TFolder, type App } from "obsidian";

/**
 * Resolve the in-vault attachment folder path without touching the filesystem.
 * Folder creation is deferred to import time (see {@link ensureFolder}), so a
 * note that embeds no images never leaves an empty folder behind.
 *
 * @returns the normalized folder path, or `"/"` for the vault root (which needs
 * no creation).
 */
export async function resolveAttachmentFolderPath(
  app: App,
  folderPath: string | null,
  sourcePath?: string,
): Promise<string> {
  let path = folderPath;
  // Empty (settings-tab "use default") is treated the same as null.
  if (!path) {
    path = dirname(
      await app.fileManager.getAvailablePathForAttachment(
        "zotlit-attachment",
        sourcePath,
      ),
    );
  }

  return normalizeFolderPath(path);
}

export async function ensureFolder(
  app: App,
  folderPath: string,
): Promise<TFolder> {
  if (folderPath === "/") return app.vault.getRoot();
  const existing = app.vault.getAbstractFileByPath(folderPath);
  if (existing instanceof TFolder) return existing;
  if (existing instanceof TFile) {
    throw new Error(`Cannot create folder; a file exists at "${folderPath}"`);
  }
  return await app.vault.createFolder(folderPath);
}

/**
 * Create the parent folder of a vault file path, unless it is the vault root —
 * `vault.create` does not make missing parents.
 */
export async function ensureParentFolder(
  app: App,
  filePath: string,
): Promise<void> {
  const dir = normalizeFolderPath(dirname(filePath));
  await ensureFolder(app, dir);
}

export function normalizeFolderPath(dir: string): string;
export function normalizeFolderPath(dir: string | null): string | null;
export function normalizeFolderPath(dir: string | null): string | null {
  if (dir === null) return null;
  if (dir === "." || dir === "/" || dir === "") return "/";
  return normalizePath(dir);
}
