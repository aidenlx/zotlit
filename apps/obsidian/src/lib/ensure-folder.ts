import { dirname } from "node:path/posix";
import { normalizePath, TFile, TFolder, type App } from "obsidian";

export async function ensureAttachmentFolder(
  app: App,
  folderPath: string | null,
  sourcePath?: string,
): Promise<TFolder> {
  let path: string;
  // Empty (settings-tab "use default") is treated the same as null.
  if (!folderPath) {
    path = dirname(
      await app.fileManager.getAvailablePathForAttachment(
        "zotlit-attachment",
        sourcePath,
      ),
    );
  } else {
    path = normalizePath(folderPath);
  }

  if (path === "." || path === "" || path === "/") {
    return app.vault.getRoot();
  }
  return ensureFolder(app, path);
}

export async function ensureFolder(
  app: App,
  folderPath: string,
): Promise<TFolder> {
  const existing = app.vault.getAbstractFileByPath(folderPath);
  if (existing instanceof TFolder) return existing;
  if (existing instanceof TFile) {
    throw new Error(`Cannot create folder; a file exists at "${folderPath}"`);
  }
  return await app.vault.createFolder(folderPath);
}
