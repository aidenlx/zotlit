// The vault-relative link targets an Item Snapshot may carry. Only a note or an
// image the vault already holds becomes a target; everything else stays absent,
// which is what the exporter reports as unavailable. No absolute path is built
// here, so none can cross the bridge.

import { Effect } from "effect";
import type { App } from "obsidian";

import { annotationHasCacheImage } from "@zotlit/db";
import type { Item } from "@zotlit/db";
import type { SnapshotVaultTargets } from "@zotlit/workbench/snapshot";

import {
  joinFolderPath,
  resolveAttachmentFolderPath,
} from "@/lib/ensure-folder";
import {
  excerptAssetIdentities,
  isOwnedExcerptAssetPath,
} from "@/services/excerpt-image/materialize";
import { referencedExcerptPaths } from "@/services/excerpt-image/references";
import type { NoteIndex } from "@/services/note-index/service";
import type { SettingsService } from "@/services/settings/service";
import type { ZoteroPrefService } from "@/services/zotero-pref/service";
import type { ZoteroReadsApi } from "@/services/zotero-reads/service";

export interface VaultTargetDeps {
  app: App;
  settings: Pick<SettingsService, "loaded">;
  noteIndex: Pick<NoteIndex, "getNotesByItemKey" | "getImportedNoteByNoteKey">;
  zoteroPref: Pick<ZoteroPrefService, "dataDir">;
}

/**
 * The note and annotation-image targets this vault can answer for `item`: its
 * own Literature Note, the imported notes of its child notes, the notes of its
 * related Items, and the excerpt images already imported beside its note.
 */
export async function collectVaultTargets(
  reads: ZoteroReadsApi,
  item: Item,
  deps: VaultTargetDeps,
): Promise<SnapshotVaultTargets> {
  const notes: Record<string, string> = {};
  const remember = (indexedKey: string, files: readonly { path: string }[]) => {
    const path = files[0]?.path;
    if (path !== undefined) notes[indexedKey] = path;
  };

  remember(item.indexedKey, deps.noteIndex.getNotesByItemKey(item.indexedKey));
  const family = await Effect.runPromise(
    reads.ItemFamily({ itemID: item.itemID }),
  );
  for (const entry of family.relatedItems) {
    remember(
      entry.indexedKey,
      deps.noteIndex.getNotesByItemKey(entry.indexedKey),
    );
  }
  for (const child of family.childNotes) {
    remember(
      child.indexedKey,
      deps.noteIndex.getImportedNoteByNoteKey(child.indexedKey),
    );
  }

  return {
    notes,
    annotationImages: await annotationImageTargets(reads, item, {
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
  reads: ZoteroReadsApi,
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
  const note = deps.notePath
    ? deps.app.vault.getFileByPath(deps.notePath)
    : null;
  const referenced = note ? await referencedExcerptPaths(deps.app, note) : [];
  const [attachments, database] = await Effect.runPromise(
    Effect.all([
      reads.AttachmentsOf({ itemIDs: [item.itemID] }),
      reads.DatabaseIdentity({}),
    ]),
  );
  for (const attachment of attachments) {
    const { annotations } = await Effect.runPromise(
      reads.AnnotationsOfAttachment({ attachmentKey: attachment.indexedKey }),
    );
    for (const annotation of annotations) {
      if (!annotationHasCacheImage(annotation.type)) continue;
      const identities = excerptAssetIdentities({
        sourceScope: deps.zoteroPref.dataDir,
        source: {
          kind: "zotero-db",
          database,
          libraryID: annotation.libraryID,
          libraryRevision: null,
        },
        libraryID: annotation.libraryID,
        attachmentKey: attachment.indexedKey,
        annotation: { key: annotation.indexedKey },
      });
      const owned = referenced.find((path) =>
        isOwnedExcerptAssetPath(path, identities),
      );
      if (owned) {
        images[annotation.indexedKey] = owned;
        continue;
      }
      const path = joinFolderPath(folder, `${annotation.key}.png`);
      if (deps.app.vault.getFileByPath(path)) {
        images[annotation.indexedKey] = path;
      }
    }
  }
  return images;
}
