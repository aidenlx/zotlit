// The vault-relative link targets an Item Snapshot may carry. Only a note or an
// image the vault already holds becomes a target; everything else stays absent,
// which is what the exporter reports as unavailable. No absolute path is built
// here, so none can cross the bridge.

import type { App } from "obsidian";

import {
  getAnnotationsByParent,
  getAttachmentsByParents,
  getChildNotesByParentIDs,
  getItemsByKey,
  getRelatedKeysByItemID,
} from "@zotlit/db";
import type { Item } from "@zotlit/db";
import type { NodeDatabaseClient } from "@zotlit/db/client/node";
import type { SnapshotVaultTargets } from "@zotlit/workbench/snapshot";

import {
  joinFolderPath,
  resolveAttachmentFolderPath,
} from "@/lib/ensure-folder";
import type { NoteIndex } from "@/services/note-index/service";
import type { SettingsService } from "@/services/settings/service";

/** Zotero annotation types that carry an excerpt image. */
const IMAGE_ANNOTATION_TYPES = new Set([3, 4]);

export interface VaultTargetDeps {
  app: App;
  settings: Pick<SettingsService, "loaded">;
  noteIndex: Pick<NoteIndex, "getNotesByItemKey" | "getImportedNoteByNoteKey">;
}

/**
 * The note and annotation-image targets this vault can answer for `item`: its
 * own Literature Note, the imported notes of its child notes, the notes of its
 * related Items, and the excerpt images already imported beside its note.
 */
export async function collectVaultTargets(
  client: NodeDatabaseClient,
  item: Item,
  deps: VaultTargetDeps,
): Promise<SnapshotVaultTargets> {
  const notes: Record<string, string> = {};
  const remember = (indexedKey: string, files: readonly { path: string }[]) => {
    const path = files[0]?.path;
    if (path !== undefined) notes[indexedKey] = path;
  };

  remember(item.indexedKey, deps.noteIndex.getNotesByItemKey(item.indexedKey));
  const related = getItemsByKey(
    client,
    item.libraryID,
    getRelatedKeysByItemID(client, item.itemID),
  );
  for (const entry of related) {
    remember(
      entry.indexedKey,
      deps.noteIndex.getNotesByItemKey(entry.indexedKey),
    );
  }
  for (const child of getChildNotesByParentIDs(client, [item.itemID])) {
    remember(
      child.indexedKey,
      deps.noteIndex.getImportedNoteByNoteKey(child.indexedKey),
    );
  }

  return {
    notes,
    annotationImages: await annotationImageTargets(client, item, {
      ...deps,
      notePath: notes[item.indexedKey],
    }),
  };
}

/**
 * Excerpt images the vault already holds. Import names each copy
 * `<annotation key>.png` in the note's attachment folder, so a file at that
 * path is the image this Item's annotation renders; anything absent is left for
 * the exporter to report rather than pointed at a Zotero cache path.
 */
async function annotationImageTargets(
  client: NodeDatabaseClient,
  item: Item,
  deps: VaultTargetDeps & { notePath: string | undefined },
): Promise<Record<string, string>> {
  const settings = await deps.settings.loaded;
  if (!settings["attachment.import"]) return {};
  const folder = await resolveAttachmentFolderPath(
    deps.app,
    settings["attachment.folder-path"],
    deps.notePath,
  );
  const images: Record<string, string> = {};
  for (const attachment of getAttachmentsByParents(client, [item.itemID])) {
    for (const annotation of getAnnotationsByParent(
      client,
      attachment.itemID,
    )) {
      if (!IMAGE_ANNOTATION_TYPES.has(annotation.type)) continue;
      const path = joinFolderPath(folder, `${annotation.key}.png`);
      if (deps.app.vault.getFileByPath(path)) {
        images[annotation.indexedKey] = path;
      }
    }
  }
  return images;
}
