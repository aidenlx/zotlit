import {
  ConfirmationModal,
  TFile,
  type MarkdownFileInfo,
  type MarkdownView,
  type Plugin,
} from "obsidian";

import * as toast from "@/lib/toast";
import * as m from "@/paraglide/messages";
import {
  isLiteratureNote,
  itemKeyFromFrontmatter,
} from "@/services/note-index/service";

import { type NoteFeatures } from "./service";

interface NoteFeatureActionDeps {
  noteFeatures: NoteFeatures;
}

export function addNoteFeatureActions(
  plugin: Pick<Plugin, "addCommand"> & { app: Plugin["app"] },
  deps: NoteFeatureActionDeps,
): void {
  plugin.addCommand({
    id: "update-note",
    name: m.command_update_note_name(),
    editorCheckCallback(checking, _editor, ctx) {
      return withLiteratureNote(plugin, { ctx, checking }, (file, itemKey) => {
        void toast.promise(deps.noteFeatures.update(file, itemKey), {
          loading: m.notice_updating_note(),
          success: (result) =>
            result.bodyUpdated
              ? m.notice_updated_note()
              : m.notice_updated_note_no_region(),
          error: m.notice_update_note_failed(),
        });
      });
    },
  });

  plugin.addCommand({
    id: "overwrite-note",
    name: m.command_overwrite_note_name(),
    editorCheckCallback(checking, _editor, ctx) {
      return withLiteratureNote(plugin, { ctx, checking }, (file, itemKey) => {
        const modal = new ConfirmationModal(plugin.app);
        modal.setTitle(m.modal_overwrite_note_title());
        modal.setContent(m.modal_overwrite_note_desc());
        modal.addButton((button) => {
          button
            .setButtonText(m.modal_overwrite_note_confirm())
            .setDestructive()
            .onClick(() => {
              void toast.promise(deps.noteFeatures.overwrite(file, itemKey), {
                loading: m.notice_overwriting_note(),
                success: m.notice_overwrote_note(),
                error: m.notice_overwrite_note_failed(),
              });
            });
        });
        modal.addCancelButton(m.modal_cancel());
        modal.open();
      });
    },
  });
}

function withLiteratureNote(
  plugin: Pick<Plugin, "app">,
  options: { ctx: MarkdownView | MarkdownFileInfo; checking: boolean },
  run: (file: TFile, itemKey: string) => void,
): boolean {
  const file = options.ctx.file;
  if (!(file instanceof TFile) || !isLiteratureNote(file, plugin.app)) {
    return false;
  }
  const itemKey = itemKeyFromFrontmatter(
    plugin.app.metadataCache.getFileCache(file),
  );
  if (!itemKey) return false;
  if (!options.checking) run(file, itemKey);
  return true;
}
