// Live orchestration for the Welcome View quick-start step actions: open settings, pick the literature-note folder and locate the Zotero data directory.
import { FuzzySuggestModal } from "obsidian";
import type { App, TFolder } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import { openSettingsTab } from "@/lib/open-settings";
import type { ViewRegistryHandle } from "@/lib/view-atoms";

import { setFolderCommand, locateZoteroCommand } from "./atoms";

export function holdSetupCommands(registry: ViewRegistryHandle): () => void {
  const releases = [
    registry.mount(setFolderCommand),
    registry.mount(locateZoteroCommand),
  ];
  return () => {
    for (const release of releases) release();
  };
}

export interface SetupActions {
  openSettings: () => void;
  pickFolder: () => void;
  locateZotero: () => void;
}

export interface SetupActionsDeps {
  app: App;
  registry: ViewRegistryHandle;
  /** Plugin id — identifies the settings tab. */
  pluginId: string;
}

export function createSetupActions(deps: SetupActionsDeps): SetupActions {
  return {
    openSettings: () => {
      openSettingsTab(deps.app, deps.pluginId, ["settings_page_zotero"]);
    },
    pickFolder: () => {
      new LiteratureFolderModal(deps.app, (folder) => {
        deps.registry.set(setFolderCommand, folder.path);
      }).open();
    },
    locateZotero: () => {
      deps.registry.set(locateZoteroCommand, undefined);
    },
  };
}

/** Vault-folder fuzzy picker; the chosen folder becomes `note.literature-folder`. */
class LiteratureFolderModal extends FuzzySuggestModal<TFolder> {
  readonly #onChoose: (folder: TFolder) => void;

  constructor(app: App, onChoose: (folder: TFolder) => void) {
    super(app);
    this.#onChoose = onChoose;
    this.setPlaceholder(m.welcome_pick_folder_placeholder());
    this.setInstructions([
      { command: "↑↓", purpose: m.instruction_navigate() },
      { command: "↵", purpose: m.instruction_select() },
      { command: "esc", purpose: m.instruction_dismiss() },
    ]);
  }

  override getItems(): TFolder[] {
    return this.app.vault.getAllFolders(false);
  }

  override getItemText(folder: TFolder): string {
    return folder.path;
  }

  override onChooseItem(folder: TFolder): void {
    this.#onChoose(folder);
  }
}
