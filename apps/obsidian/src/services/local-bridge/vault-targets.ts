// The vault-relative link targets an Item Snapshot may carry. Only a note or an
// image the vault already holds becomes a target; everything else stays absent,
// which is what the exporter reports as unavailable. No absolute path is built
// here, so none can cross the bridge.

import { Effect } from "effect";
import type { TFile } from "obsidian";

import { annotationHasCacheImage } from "@zotlit/db";
import type { Item } from "@zotlit/db";
import type { SnapshotVaultTargets } from "@zotlit/workbench/snapshot";

import { joinFolderPath } from "@/lib/ensure-folder";
import { FileManager } from "@/lib/obsidian-file-manager";
import { MetadataCache } from "@/lib/obsidian-metadata-cache";
import { Vault } from "@/lib/obsidian-vault";
import { Workspace } from "@/lib/obsidian-workspace";
import {
  excerptAssetIdentities,
  isOwnedExcerptAssetPath,
} from "@/services/excerpt-image/materialize";
import { linkTargets } from "@/services/excerpt-image/references";
import { NoteIndex } from "@/services/note-index/service";
import { PluginSettings } from "@/services/settings/service";
import { attachmentFolder } from "@/services/template-workbench/data";
import { ZoteroPref } from "@/services/zotero-pref/service";
import type { ZoteroReadsApi } from "@/services/zotero-reads/service";

/** The services the vault targets read. */
export type VaultTargetServices =
  | NoteIndex
  | PluginSettings
  | ZoteroPref
  | Vault
  | FileManager
  | MetadataCache
  | Workspace;

/**
 * The note and annotation-image targets this vault can answer for `item`: its
 * own Literature Note, the imported notes of its child notes, the notes of its
 * related Items, and the excerpt images already imported beside its note.
 */
export const collectVaultTargets = Effect.fnUntraced(function* (
  reads: ZoteroReadsApi,
  item: Item,
) {
  const index = yield* NoteIndex;
  const notes: Record<string, string> = {};
  const remember = (indexedKey: string, files: readonly { path: string }[]) => {
    const path = files[0]?.path;
    if (path !== undefined) notes[indexedKey] = path;
  };

  remember(item.indexedKey, yield* index.getNotesByItemKey(item.indexedKey));
  const family = yield* reads.ItemFamily({ itemID: item.itemID });
  for (const entry of family.relatedItems) {
    remember(
      entry.indexedKey,
      yield* index.getNotesByItemKey(entry.indexedKey),
    );
  }
  for (const child of family.childNotes) {
    remember(
      child.indexedKey,
      yield* index.getImportedNoteByNoteKey(child.indexedKey),
    );
  }

  const targets: SnapshotVaultTargets = {
    notes,
    annotationImages: yield* annotationImageTargets(
      reads,
      item,
      notes[item.indexedKey],
    ),
  };
  return targets;
});

/**
 * Excerpt images the vault already holds. Import names each copy
 * `<annotation key>.png` in the note's attachment folder, so a file at that
 * path is the image this Item's annotation renders; anything absent is left for
 * the exporter to report rather than pointed at a Zotero cache path.
 */
const annotationImageTargets = Effect.fnUntraced(function* (
  reads: ZoteroReadsApi,
  item: Item,
  notePath: string | undefined,
) {
  const images: Record<string, string> = {};
  const settings = yield* (yield* PluginSettings).current;
  if (!settings["attachment.import"]) return images;
  const vault = yield* Vault;
  const folder = yield* attachmentFolder(
    yield* FileManager,
    settings["attachment.folder-path"],
    notePath,
  );
  const note = notePath ? yield* vault.getFileByPath(notePath) : null;
  const referenced = note ? yield* referencedPaths(note) : [];
  const { dataDir } = yield* (yield* ZoteroPref).current;
  const [attachments, database] = yield* Effect.all([
    reads.AttachmentsOf({ itemIDs: [item.itemID] }),
    reads.DatabaseIdentity({}),
  ]);
  for (const attachment of attachments) {
    const { annotations } = yield* reads.AnnotationsOfAttachment({
      attachmentKey: attachment.indexedKey,
    });
    for (const annotation of annotations) {
      if (!annotationHasCacheImage(annotation.type)) continue;
      const identities = excerptAssetIdentities({
        sourceScope: dataDir,
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
      if (yield* vault.getFileByPath(path)) {
        images[annotation.indexedKey] = path;
      }
    }
  }
  return images;
});

/**
 * The vault files `note`'s live text links to: its loaded view's text, else
 * the vault's, read apart from the asynchronous metadata cache.
 */
const referencedPaths = Effect.fnUntraced(function* (note: TFile) {
  const view = yield* (yield* Workspace).loadedTextView(note);
  const content =
    view === null ? yield* (yield* Vault).cachedRead(note) : view.getViewData();
  const metadata = yield* MetadataCache;
  const paths = new Set<string>();
  for (const link of linkTargets(content)) {
    const target = yield* metadata.firstLinkpathDest(link, note.path);
    if (target) paths.add(target.path);
  }
  return [...paths];
});
