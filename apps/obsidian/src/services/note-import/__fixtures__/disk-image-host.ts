// An in-memory Obsidian host for note-import tests whose images live on disk.
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { FileSystemAdapter } from "obsidian";

import { createObsidianHost } from "@/lib/__fixtures__/obsidian-host";

/**
 * An in-memory host whose images live on disk under `vaultRoot`: a folder the
 * vault creates is made on disk too, and an image the filesystem adapter
 * publishes joins the vault.
 */
export function diskImageHost(vaultRoot: string) {
  const host = createObsidianHost();
  const createFolder = host.vault.createFolder.bind(host.vault);
  Object.assign(host.vault, {
    adapter: Object.assign(Object.create(FileSystemAdapter.prototype), {
      getFullPath: (path: string) => join(vaultRoot, path),
      reconcileInternalFile: async (path: string) => {
        if (!host.vault.getFileByPath(path)) host.vault.addFile(path, "");
      },
    }),
    createFolder: async (path: string) => {
      await mkdir(join(vaultRoot, path), { recursive: true });
      return createFolder(path);
    },
  });
  Object.assign(host.metadataCache, {
    getFirstLinkpathDest: (path: string) => host.vault.getFileByPath(path),
  });
  return host;
}
