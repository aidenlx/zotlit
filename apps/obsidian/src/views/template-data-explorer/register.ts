import "./style.css";
import { TFile } from "obsidian";
import type { App, Plugin } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import type { DatabaseService } from "@/services/database/service";
import type { ItemLookup } from "@/services/item-lookup/service";
import { itemKeyFromFrontmatter } from "@/services/note-index/parse";
import type { NoteIndex } from "@/services/note-index/service";
import type { SettingsService } from "@/services/settings/service";
import type { TemplateService } from "@/services/template/service";
import type { ZoteroPrefService } from "@/services/zotero-pref/service";

import { EXPLORER_VIEW_TYPE, TemplateDataExplorerView } from "./view";

type ExplorerPlugin = Pick<
  Plugin,
  "registerView" | "addCommand" | "registerEvent" | "app"
>;

export interface ExplorerRegistrationDeps {
  app: App;
  db: DatabaseService;
  noteIndex: NoteIndex;
  zoteroPref: ZoteroPrefService;
  itemLookup: ItemLookup;
  settings: SettingsService;
  templates: TemplateService;
}

export function registerTemplateDataExplorer(
  plugin: ExplorerPlugin,
  deps: ExplorerRegistrationDeps,
): void {
  plugin.registerView(
    EXPLORER_VIEW_TYPE,
    (leaf) => new TemplateDataExplorerView(leaf, deps),
  );

  plugin.addCommand({
    id: "open-template-data-explorer",
    name: m.command_open_template_data_explorer_name(),
    callback: () => void openTemplateDataExplorer(plugin.app),
  });

  registerExplorerFileMenu(plugin);
}

/** Every in-vault entry point delegates to this function. */
export async function openTemplateDataExplorer(
  app: App,
  state?: { itemIndexedKey: string; anchorAnnotationKey?: string },
): Promise<void> {
  const { workspace } = app;
  let leaf = workspace.getLeavesOfType(EXPLORER_VIEW_TYPE)[0];
  if (!leaf) {
    const right = workspace.getRightLeaf(false);
    if (!right) return;
    leaf = right;
    await leaf.setViewState({ type: EXPLORER_VIEW_TYPE, active: true, state });
  } else if (state) {
    await leaf.setViewState({ type: EXPLORER_VIEW_TYPE, active: true, state });
  }
  void workspace.revealLeaf(leaf);
}

function registerExplorerFileMenu(
  plugin: Pick<Plugin, "registerEvent" | "app">,
): void {
  plugin.registerEvent(
    plugin.app.workspace.on("file-menu", (menu, file, source) => {
      if (!(file instanceof TFile) || file.extension !== "md") return;
      if (source === "files-menu") return;
      const cache = plugin.app.metadataCache.getFileCache(file);
      const itemKey = itemKeyFromFrontmatter(cache);
      if (!itemKey) return;
      menu.addItem((item) =>
        item
          .setSection("zotlit")
          .setTitle(m.template_data_explorer_menu_explore())
          .setIcon("braces")
          .onClick(() => {
            void openTemplateDataExplorer(plugin.app, {
              itemIndexedKey: itemKey,
            });
          }),
      );
    }),
  );
}
