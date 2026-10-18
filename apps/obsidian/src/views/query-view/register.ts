// The Query File as an Obsidian file type: its tab, its embed in a note, and
// "New query file" in the command palette and the file explorer's menus, and
// "New Zotero query table" on the empty tab.
import { Keymap, normalizePath } from "obsidian";
import type { App, Menu, Plugin, TFile, TFolder } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import { MENU_SECTION } from "@/lib/menu-section";
import { registerEmbed } from "@/lib/obsidian-private/embed-registry";
import type { FileMenuSegment, FolderMenuSegment } from "@/services/file-menu";

import { createQueryFileEmbed } from "./embed";
import { installEmptyViewAction } from "./empty-view-action";
import { QueryFileView, QUERY_FILE_VIEW_TYPE } from "./file-view";
import {
  newQueryFileText,
  QUERY_FILE_EXTENSION,
  untitledName,
} from "./query-file";
import type { QueryViewDeps } from "./view";

type QueryFilePlugin = Pick<
  Plugin,
  "registerView" | "registerExtensions" | "addCommand" | "register" | "app"
>;

export function registerQueryFileView(
  plugin: QueryFilePlugin,
  deps: QueryViewDeps,
): void {
  plugin.registerView(
    QUERY_FILE_VIEW_TYPE,
    (leaf) => new QueryFileView(leaf, deps),
  );
  plugin.registerExtensions([QUERY_FILE_EXTENSION], QUERY_FILE_VIEW_TYPE);
  const unregisterEmbed = registerEmbed(
    plugin.app,
    QUERY_FILE_EXTENSION,
    createQueryFileEmbed(deps),
  );
  if (unregisterEmbed) plugin.register(unregisterEmbed);
  const { app } = plugin;
  const newQueryFile = (event?: MouseEvent | KeyboardEvent) =>
    void createQueryFile(
      app,
      app.fileManager.getNewFileParent(
        app.workspace.getActiveFile()?.path ?? "",
      ),
      event,
    );
  const command = plugin.addCommand({
    id: "new-query-file",
    name: m.command_new_query_file_name(),
    callback: () => newQueryFile(),
  });
  // The empty tab is patched once the layout holds leaves to reach it from;
  // a plugin unloaded before then installs nothing.
  const emptyTab = new DisposableStack();
  plugin.register(() => emptyTab.dispose());
  app.workspace.onLayoutReady(() => {
    if (emptyTab.disposed) return;
    emptyTab.use(
      installEmptyViewAction(app, { commandId: command.id, run: newQueryFile }),
    );
  });
}

/** The first `Untitled.zotquery`, `Untitled 1.zotquery`, … free in `folder`. */
function freePath(app: App, folder: TFolder): string {
  const path = (name: string) =>
    normalizePath(
      `${folder.isRoot() ? "" : `${folder.path}/`}${name}.${QUERY_FILE_EXTENSION}`,
    );
  return path(
    untitledName(
      m.query_file_untitled(),
      (name) => app.vault.getAbstractFileByPath(path(name)) !== null,
    ),
  );
}

/**
 * Create a Query File in `folder` that opens on a Table of the library's
 * Items, with its Annotations as a second view, and open it with its title
 * ready to rename, as Obsidian opens a new note. A Cmd/Ctrl press opens it in
 * a new tab.
 */
export async function createQueryFile(
  app: App,
  folder: TFolder,
  event?: MouseEvent | KeyboardEvent,
): Promise<TFile> {
  const file = await app.vault.create(
    freePath(app, folder),
    newQueryFileText({
      items: m.query_file_items_view_name(),
      annotations: m.query_file_annotations_view_name(),
    }),
  );
  const leaf = app.workspace.getLeaf(event ? Keymap.isModEvent(event) : false);
  await leaf.openFile(file, { active: true, eState: { rename: "all" } });
  return file;
}

function addNewQueryFile(menu: Menu, app: App, folder: TFolder): void {
  menu.addItem((item) =>
    item
      .setSection(MENU_SECTION.create)
      .setTitle(m.query_file_new())
      .setIcon("list-filter")
      .onClick((event) => void createQueryFile(app, folder, event)),
  );
}

/** "New query file" on a folder in the file explorer. */
export function queryFileFolderMenu(app: App): FolderMenuSegment {
  return (menu, { folder, source }) => {
    if (source !== "file-explorer-context-menu") return;
    addNewQueryFile(menu, app, folder);
  };
}

/** "New query file" on a file in the file explorer, in the folder that holds it. */
export function queryFileFileMenu(app: App): FileMenuSegment {
  return (menu, { file, source }) => {
    if (source !== "file-explorer-context-menu" || !file.parent) return;
    addNewQueryFile(menu, app, file.parent);
  };
}
