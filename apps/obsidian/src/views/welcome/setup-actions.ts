// Live orchestration for the Welcome View quick-start step actions: open settings, pick the literature-note folder, search the library, and locate the Zotero data directory.
import { type App, FuzzySuggestModal, type TFolder } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { openSettingsTab } from "@/lib/open-settings";
import { requireDialog } from "@/lib/require";
import { type SettingsService } from "@/services/settings/service";
import { type ZoteroPrefService } from "@/services/zotero-pref/service";

const logger = getLogger(["views", "welcome"]);

export interface SetupActions {
  openSettings: () => void;
  pickFolder: () => void;
  searchLibrary: () => void;
  locateZotero: () => void;
}

export interface SetupActionsDeps {
  app: App;
  settings: Pick<SettingsService, "update">;
  zoteroPref: Pick<ZoteroPrefService, "dataDir" | "setDataDir">;
  /** Plugin id — prefixes command ids and identifies the settings tab. */
  pluginId: string;
}

export function createSetupActions(deps: SetupActionsDeps): SetupActions {
  return {
    openSettings: () => {
      openSettingsTab(deps.app, deps.pluginId, [m.settings_page_database()]);
    },
    pickFolder: () => {
      new LiteratureFolderModal(deps.app, (folder) => {
        deps.settings.update({ "note.literature-folder": folder.path });
      }).open();
    },
    searchLibrary: () => {
      deps.app.commands.executeCommandById(
        `${deps.pluginId}:note-quick-switcher`,
      );
    },
    locateZotero: () => {
      void browseForDataDir(deps);
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

/** Mirror the settings data-dir browse flow: pick a directory, save it as this device's data-dir override. */
async function browseForDataDir(deps: SetupActionsDeps): Promise<void> {
  try {
    const result = await requireDialog().showOpenDialog({
      title: m.settings_db_data_dir_dialog_title(),
      defaultPath: deps.zoteroPref.dataDir,
      properties: ["openDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return;
    deps.zoteroPref.setDataDir(result.filePaths[0]!);
  } catch (error) {
    logger.error("Failed to open Zotero data directory dialog", { error });
  }
}
