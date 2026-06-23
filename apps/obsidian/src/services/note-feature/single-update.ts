import { type App } from "obsidian";

import { getItemsByID, type ItemRef } from "@zotlit/db";

import * as toast from "@/lib/toast";
import * as m from "@/paraglide/messages";
import { type DatabaseService } from "@/services/database/service";
import { type NoteFeatureContext } from "@/services/note-feature/context";
import { EmptyFilenameError } from "@/services/note-feature/filename";
import {
  createNote,
  updateNote as applyNoteUpdate,
} from "@/services/note-feature/operations";
import {
  itemKeyFromFrontmatter,
  type NoteIndex,
} from "@/services/note-index/service";
import { type SettingsService } from "@/services/settings/service";

/**
 * The slice of a protocol handler's dependencies needed to create / update a
 * single literature note. Shared by the `update` / `open` URL actions and the
 * batch runner's one-actionable fast path so all three behave identically.
 */
export interface SingleUpdateDeps {
  app: App;
  db: DatabaseService;
  settings: SettingsService;
  noteFeatures: NoteFeatureContext;
  noteIndex: NoteIndex;
}

/** Update the existing literature note, or create + open one if none exists. */
export async function updateNote(
  deps: SingleUpdateDeps,
  ref: ItemRef,
): Promise<void> {
  const file = deps.noteIndex.getNotesByItemKey(ref.indexedKey)[0];

  if (!file) {
    await createAndOpen(deps, ref);
    return;
  }

  const itemKey = itemKeyFromFrontmatter(
    deps.app.metadataCache.getFileCache(file),
  );
  if (!itemKey) return;

  void toast.promise(applyNoteUpdate(deps.noteFeatures, file, itemKey), {
    loading: m.notice_updating_note(),
    success: (result) =>
      result.bodyUpdated
        ? m.notice_updated_note()
        : m.notice_updated_note_no_region(),
    error: m.notice_update_note_failed(),
  });
}

/** Lazily resolve the full Item and create + open a new literature note. */
export async function createAndOpen(
  deps: SingleUpdateDeps,
  ref: ItemRef,
): Promise<void> {
  const [item] = getItemsByID(deps.db.client, [ref.itemID]);
  if (!item) return;

  try {
    const file = await toast.promise(createNote(deps.noteFeatures, item), {
      loading: m.notice_creating_note(),
      success: m.notice_created_note(),
      error: (_msg, e) =>
        e instanceof EmptyFilenameError
          ? e.message
          : m.notice_create_note_failed(),
      swallowError: false,
    });
    await deps.app.workspace.openLinkText(file.path, "", false, {
      active: true,
    });
  } catch {
    // toast.promise already surfaced the failure.
  }
}
