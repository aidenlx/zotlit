// The attachment folder a note's imports land in, read through the FileManager tag.
import { Effect } from "effect";
import { dirname } from "node:path/posix";

import { normalizeFolderPath } from "@/lib/ensure-folder";
import { FileManager } from "@/lib/obsidian-file-manager";
import type { VaultError } from "@/lib/vault-errors";

/**
 * `resolveAttachmentFolderPath` (`@/lib/ensure-folder`) over the FileManager
 * tag: `folderPath`, or Obsidian's own attachment folder for the note at
 * `sourcePath` when the setting is empty. `"/"` names the vault root.
 */
export const attachmentFolderPath = (
  folderPath: string | null,
  sourcePath?: string,
): Effect.Effect<string, VaultError, FileManager> =>
  folderPath
    ? Effect.succeed(normalizeFolderPath(folderPath))
    : FileManager.use((fileManager) =>
        fileManager.getAvailablePathForAttachment(
          "zotlit-attachment",
          sourcePath,
        ),
      ).pipe(Effect.map((path) => normalizeFolderPath(dirname(path))));
