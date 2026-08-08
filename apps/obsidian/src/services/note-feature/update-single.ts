import type { App, TFile } from "obsidian";

import { getItemsByID } from "@zotlit/db";
import type { Item, ItemRef } from "@zotlit/db";

import * as m from "@/lib/i18n/generated/messages";
import { BaseNotice } from "@/lib/notice";
import * as toast from "@/lib/toast";
import type { DatabaseService } from "@/services/database/service";
import { EmptyFilenameError } from "@/services/note-feature/filename";
import type {
  NoteFeature,
  UpdateResult,
  UpdateScope,
} from "@/services/note-feature/operations";
import { itemKeyFromFrontmatter } from "@/services/note-index/service";
import type { NoteIndex } from "@/services/note-index/service";
import type { SettingsService } from "@/services/settings/service";
import { InertTemplateError } from "@/services/template/errors";

/**
 * The slice of a protocol handler's dependencies needed to create / update a
 * single literature note. Shared by the `update` / `open` URL actions and the
 * batch runner's one-actionable fast path so all three behave identically.
 */
export interface SingleUpdateDeps {
  app: App;
  db: DatabaseService;
  settings: SettingsService;
  noteFeature: NoteFeature;
  noteIndex: NoteIndex;
}

/**
 * Update the existing literature note, or create + open one if none exists.
 * `scope` controls how much an existing note is refreshed (see {@link UpdateScope}).
 *
 * A `metadata` scope never creates: the whole point of the narrowing is to leave
 * the body alone, and `createNote` would write a full templated one. Missing
 * notes report and stop, leaving the full-scope action as the way to create.
 */
export async function updateNote(
  deps: SingleUpdateDeps,
  ref: ItemRef,
  scope: UpdateScope = "full",
): Promise<void> {
  const file = deps.noteIndex.getNotesByItemKey(ref.indexedKey)[0];

  if (!file) {
    if (scope === "metadata") {
      new BaseNotice(m.notice_update_metadata_no_note());
      return;
    }
    await createAndOpen(deps, ref);
    return;
  }

  const itemKey = itemKeyFromFrontmatter(
    deps.app.metadataCache.getFileCache(file),
  );
  if (!itemKey) return;

  void toast.promise(
    deps.noteFeature.updateNote(file, { indexedKey: itemKey, scope }),
    updateNoteToast(scope),
  );
}

/** Toast copy for a single-note update, framed by `scope`. A `metadata` update
 *  never touches the body, so it reports as "metadata updated" rather than the
 *  full update's region-aware messages. */
export function updateNoteToast(scope: UpdateScope): {
  loading: string;
  success: (result: UpdateResult) => string;
  error: (_msg: string, e: unknown) => string;
} {
  const error = (_msg: string, e: unknown): string =>
    e instanceof InertTemplateError ? e.message : m.notice_update_note_failed();
  if (scope === "metadata") {
    return {
      loading: m.notice_updating_note_metadata(),
      success: () => m.notice_updated_note_metadata(),
      error,
    };
  }
  return {
    loading: m.notice_updating_note(),
    success: (result) =>
      result.bodyUpdated
        ? m.notice_updated_note()
        : m.notice_updated_note_no_region(),
    error,
  };
}

/** Lazily resolve the full Item and create + open a new literature note. */
export async function createAndOpen(
  deps: SingleUpdateDeps,
  ref: ItemRef,
): Promise<void> {
  const [item] = getItemsByID(deps.db.client, [ref.itemID]);
  if (!item) return;

  const file = await createNoteWithToast(deps.noteFeature, item);
  if (!file) return;
  await deps.app.workspace.openLinkText(file.path, "", false, {
    active: true,
  });
}

/**
 * Create a literature note for `item` behind the standard create toast. Returns
 * the created file, or `null` when creation failed — the toast already surfaced
 * the failure, so callers only need to skip their follow-up.
 */
export async function createNoteWithToast(
  noteFeature: Pick<NoteFeature, "createNote">,
  item: Item,
): Promise<TFile | null> {
  try {
    return await toast.promise(noteFeature.createNote(item), {
      loading: m.notice_creating_note(),
      success: m.notice_created_note(),
      error: (_msg, e) =>
        e instanceof EmptyFilenameError || e instanceof InertTemplateError
          ? e.message
          : m.notice_create_note_failed(),
      swallowError: false,
    });
  } catch {
    return null;
  }
}
