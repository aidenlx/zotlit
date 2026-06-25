import {
  TFile,
  type MarkdownFileInfo,
  type MarkdownView,
  type Plugin,
} from "obsidian";

import { confirm } from "@/lib/confirm";
import * as toast from "@/lib/toast";
import * as m from "@/paraglide/messages";
import {
  isLiteratureNote,
  itemKeyFromFrontmatter,
} from "@/services/note-index/service";

import { type NoteFeatureContext } from "./context";
import { overwriteNote, updateNote, type UpdateScope } from "./operations";
import { updateNoteToast } from "./single-update";

interface NoteFeatureActionDeps {
  noteFeatures: NoteFeatureContext;
}

export function addNoteFeatureActions(
  plugin: Pick<Plugin, "addCommand"> & { app: Plugin["app"] },
  deps: NoteFeatureActionDeps,
): void {
  addUpdateCommand(plugin, deps, {
    id: "update-note",
    name: m.command_update_note_name(),
    scope: "full",
  });
  addUpdateCommand(plugin, deps, {
    id: "update-note-metadata",
    name: m.command_update_note_metadata_name(),
    scope: "metadata",
  });

  plugin.addCommand({
    id: "overwrite-note",
    name: m.command_overwrite_note_name(),
    editorCheckCallback(checking, _editor, ctx) {
      return withLiteratureNote(plugin, { ctx, checking }, (file, itemKey) => {
        void confirm(
          {
            title: m.modal_overwrite_note_title(),
            content: m.modal_overwrite_note_desc(),
            action: m.modal_overwrite_note_confirm(),
            destructive: true,
          },
          plugin.app,
        ).then(async (yes) => {
          if (!yes) return;
          await toast.promise(overwriteNote(deps.noteFeatures, file, itemKey), {
            loading: m.notice_overwriting_note(),
            success: m.notice_overwrote_note(),
            error: m.notice_overwrite_note_failed(),
          });
        });
      });
    },
  });
}

/** Register an editor command that updates the active literature note at the
 *  given {@link UpdateScope}. */
function addUpdateCommand(
  plugin: Pick<Plugin, "addCommand"> & { app: Plugin["app"] },
  deps: NoteFeatureActionDeps,
  command: { id: string; name: string; scope: UpdateScope },
): void {
  plugin.addCommand({
    id: command.id,
    name: command.name,
    editorCheckCallback(checking, _editor, ctx) {
      return withLiteratureNote(plugin, { ctx, checking }, (file, itemKey) => {
        void toast.promise(
          updateNote(deps.noteFeatures, file, {
            indexedKey: itemKey,
            scope: command.scope,
          }),
          updateNoteToast(command.scope),
        );
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
