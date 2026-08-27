import type { App, TFile } from "obsidian";

import { getItemsByID } from "@zotlit/db";
import type { Item, ItemRef } from "@zotlit/db";

import * as m from "@/lib/i18n/generated/messages";
import { BaseNotice } from "@/lib/notice";
import * as toast from "@/lib/toast";
import type { DatabaseService } from "@/services/database/service";
import type { LibraryScopeService } from "@/services/library-scope/service";
import { EmptyFilenameError } from "@/services/note-feature/filename";
import type {
  CreateNoteResult,
  NoteFeature,
  NoteOperationDiagnostic,
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
  /** Which Libraries an unqualified library-wide update covers. */
  libraryScope: Pick<LibraryScopeService, "resolveWith">;
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
  {
    scope = "full",
    profileId,
  }: { scope?: UpdateScope; profileId?: string | null } = {},
): Promise<void> {
  const file = resolveLiteratureNoteWithWarning(
    deps.noteIndex.getNotesByItemKey(ref.indexedKey),
  );

  if (!file) {
    if (scope === "metadata") {
      new BaseNotice(m.notice_update_metadata_no_note());
      return;
    }
    await createAndOpen(deps, ref, profileId);
    return;
  }

  const itemKey = itemKeyFromFrontmatter(
    deps.app.metadataCache.getFileCache(file),
  );
  if (!itemKey) return;

  void toast.promise(
    deps.noteFeature.updateNote(file, {
      indexedKey: itemKey,
      scope,
      profileId,
    }),
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
      success: (result) =>
        result.diagnostic
          ? noteOperationDiagnosticNotice(result.diagnostic)
          : m.notice_updated_note_metadata(),
      error,
    };
  }
  return {
    loading: m.notice_updating_note(),
    success: (result) =>
      result.diagnostic
        ? noteOperationDiagnosticNotice(result.diagnostic)
        : result.bodyUpdated
          ? m.notice_updated_note()
          : result.noManagedBlock
            ? m.notice_updated_note_no_managed_block()
            : m.notice_updated_note_no_region(),
    error,
  };
}

/** Lazily resolve the full Item and create + open a new literature note. */
export async function createAndOpen(
  deps: SingleUpdateDeps,
  ref: ItemRef,
  profileId?: string | null,
): Promise<void> {
  const [item] = getItemsByID(deps.db.client, [ref.itemID]);
  if (!item) return;

  const file = await createNoteWithToast(deps.noteFeature, item, profileId);
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
  profileId?: string | null,
): Promise<TFile | null> {
  try {
    const result = await toast.promise(
      noteFeature.createNote(item, { profileId }),
      {
        loading: m.notice_creating_note(),
        success: createNoteNotice,
        error: (_msg, e) =>
          e instanceof EmptyFilenameError || e instanceof InertTemplateError
            ? e.message
            : m.notice_create_note_failed(),
        swallowError: false,
      },
    );
    return result.outcome === "created" ? result.file : null;
  } catch {
    return null;
  }
}

export function createNoteNotice(result: CreateNoteResult): string {
  if (result.outcome === "created") return m.notice_created_note();
  const { diagnostic } = result;
  switch (diagnostic.code) {
    case "literature-note-exists":
      return m.notice_create_note_exists({ path: diagnostic.paths[0] });
    case "duplicate-literature-notes":
      return m.notice_create_note_duplicates({
        paths: diagnostic.paths.join(", "),
      });
    case "unknown-literature-note-profile":
    case "literature-note-profile-conflict":
    case "missing-literature-note-template":
    case "literature-note-template-conversion-required":
    case "managed-frontmatter-refused":
      return noteOperationDiagnosticNotice(diagnostic);
  }
}

export function noteOperationDiagnosticNotice(
  diagnostic: NoteOperationDiagnostic,
): string {
  switch (diagnostic.code) {
    case "unknown-literature-note-profile":
      return m.notice_literature_note_profile_unknown({
        id: diagnostic.profileId,
      });
    case "literature-note-profile-conflict":
      return m.notice_literature_note_profile_conflict();
    case "missing-literature-note-template":
      return m.notice_literature_note_template_missing({
        document: diagnostic.document,
      });
    case "literature-note-template-conversion-required":
      return m.notice_literature_note_template_conversion_required();
    case "managed-frontmatter-refused":
      return m.notice_managed_frontmatter_refused({
        fields: diagnostic.failures.map(({ field }) => field).join(", "),
      });
  }
}

export function duplicateLiteratureNoteWarning(
  notes: readonly Pick<TFile, "path">[],
): string | null {
  if (notes.length < 2) return null;
  return m.notice_duplicate_literature_notes({
    paths: notes.map((file) => file.path).join(", "),
    selected: notes[0]!.path,
  });
}

export function resolveLiteratureNoteWithWarning(
  notes: readonly TFile[],
): TFile | undefined {
  const warning = duplicateLiteratureNoteWarning(notes);
  if (warning) new BaseNotice(warning);
  return notes[0];
}
