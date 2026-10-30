import { TFile } from "obsidian";
import type {
  App,
  MarkdownFileInfo,
  MarkdownView,
  Menu,
  Plugin,
} from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import { MENU_SECTION } from "@/lib/menu-section";
import type { FileMenuContext, FileMenuSegment } from "@/services/file-menu";
import {
  isLiteratureNote,
  itemKeyFromFrontmatter,
  noteKeyFromFrontmatter,
} from "@/services/note-index/service";

import type { NoteActions } from "./actions-handle";
import type { UpdateScope } from "./operations";

interface NoteFeatureActionDeps {
  app: App;
  noteActions: NoteActions;
  /** Runs Import child notes for the item `indexedKey` names. */
  importChildNotes: (indexedKey: string) => void;
}

export function addNoteFeatureActions(
  plugin: Pick<Plugin, "addCommand" | "registerEvent"> & {
    app: Plugin["app"];
  },
  deps: NoteFeatureActionDeps,
): void {
  plugin.registerEvent(
    deps.app.workspace.on("zotlit:switch-profile", ({ path }) => {
      const file = deps.app.vault.getFileByPath(path);
      if (!file) return;
      const cache = deps.app.metadataCache.getFileCache(file);
      if (itemKeyFromFrontmatter(cache) || noteKeyFromFrontmatter(cache))
        void deps.noteActions.switchProfile(file);
    }),
  );

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
    id: "switch-literature-note-profile",
    name: m.command_switch_literature_note_profile_name(),
    checkCallback(checking) {
      const file = deps.app.workspace.getActiveFile();
      if (!file || !isLiteratureNote(file, deps.app)) return false;
      if (!checking) void deps.noteActions.switchProfile(file);
      return true;
    },
  });

  plugin.addCommand({
    id: "overwrite-note",
    name: m.command_overwrite_note_name(),
    editorCheckCallback(checking, _editor, ctx) {
      return withLiteratureNote(plugin, { ctx, checking }, (file, itemKey) => {
        void deps.noteActions.overwriteNote(file, itemKey);
      });
    },
  });

  plugin.addCommand({
    id: "reimport-note",
    name: m.command_reimport_note_name(),
    editorCheckCallback(checking, _editor, ctx) {
      return withImportedNote(plugin, { ctx, checking }, (file, noteKey) => {
        void deps.noteActions.reimportNote(file, noteKey);
      });
    },
  });

  plugin.addCommand({
    id: "update-all-notes",
    name: m.command_update_all_notes_name(),
    callback() {
      void deps.noteActions.updateAll();
    },
  });
}

/**
 * The note operations on a Literature Note's or a Note Import's file menu.
 * Overwrite and reimport replace what the user wrote, so they stand with
 * "Delete" rather than with the updates.
 */
export function noteFeatureFileMenu(
  deps: NoteFeatureActionDeps,
): FileMenuSegment {
  return (menu, ctx) => buildFileMenu(menu, ctx, deps);
}

function buildFileMenu(
  menu: Menu,
  { file, itemKey, noteKey }: FileMenuContext,
  deps: NoteFeatureActionDeps,
): void {
  if (itemKey) {
    menu.addItem((item) =>
      item
        .setSection(MENU_SECTION.action)
        .setTitle(m.command_update_note_name())
        .setIcon("refresh-cw")
        .onClick(() => {
          void deps.noteActions.updateNote(file, { itemKey, scope: "full" });
        }),
    );
    menu.addItem((item) =>
      item
        .setSection(MENU_SECTION.action)
        .setTitle(m.command_update_note_metadata_name())
        .setIcon("file-text")
        .onClick(() => {
          void deps.noteActions.updateNote(file, {
            itemKey,
            scope: "metadata",
          });
        }),
    );
    menu.addItem((item) =>
      item
        .setSection(MENU_SECTION.danger)
        .setTitle(m.command_overwrite_note_name())
        .setWarning(true)
        .setIcon("file-x")
        .onClick(() => {
          void deps.noteActions.overwriteNote(file, itemKey);
        }),
    );
    menu.addItem((item) =>
      item
        .setSection(MENU_SECTION.action)
        .setTitle(m.command_import_child_notes_name())
        .setIcon("download")
        .onClick(() => {
          deps.importChildNotes(itemKey);
        }),
    );
    return;
  }
  if (noteKey) {
    menu.addItem((item) =>
      item
        .setSection(MENU_SECTION.danger)
        .setTitle(m.command_reimport_note_name())
        .setWarning(true)
        .setIcon("refresh-cw")
        .onClick(() => {
          void deps.noteActions.reimportNote(file, noteKey);
        }),
    );
  }
}

/**
 * Register a command that updates the active literature note at the
 * given {@link UpdateScope}.
 */
function addUpdateCommand(
  plugin: Pick<Plugin, "addCommand"> & { app: Plugin["app"] },
  deps: NoteFeatureActionDeps,
  command: { id: string; name: string; scope: UpdateScope },
): void {
  plugin.addCommand({
    id: command.id,
    name: command.name,
    checkCallback(checking) {
      const ctx = { file: deps.app.workspace.getActiveFile() };
      return withLiteratureNote(plugin, { ctx, checking }, (file, itemKey) => {
        void deps.noteActions.updateNote(file, {
          itemKey,
          scope: command.scope,
        });
      });
    },
  });
}

/**
 * Run `run` on the Literature Note `ctx` holds, unless `checking`: whether a
 * command applies there.
 */
export function withLiteratureNote(
  plugin: Pick<Plugin, "app">,
  options: { ctx: Pick<MarkdownFileInfo, "file">; checking: boolean },
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

function withImportedNote(
  plugin: Pick<Plugin, "app">,
  options: { ctx: MarkdownView | MarkdownFileInfo; checking: boolean },
  run: (file: TFile, noteKey: string) => void,
): boolean {
  const file = options.ctx.file;
  if (!(file instanceof TFile)) return false;
  const noteKey = noteKeyFromFrontmatter(
    plugin.app.metadataCache.getFileCache(file),
  );
  if (!noteKey) return false;
  if (!options.checking) run(file, noteKey);
  return true;
}
