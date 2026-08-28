import type { App, Plugin } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import type { ItemLookup } from "@/services/item-lookup/service";
import type { NoteFeature } from "@/services/note-feature";
import type { NoteIndex } from "@/services/note-index/service";
import { noteKeyFromFrontmatter } from "@/services/note-index/service";
import type { SettingsService } from "@/services/settings/service";

import { QuickSwitchModal, switchImportedNoteProfile } from "./modal";

export interface QuickSwitchDeps {
  app: App;
  lookup: ItemLookup;
  noteIndex: NoteIndex;
  noteFeature: Pick<
    NoteFeature,
    | "createNote"
    | "getImportedNotesForItem"
    | "switchImportedNoteProfile"
    | "switchNoteProfile"
  >;
  settings: SettingsService;
}

export function registerQuickSwitch(
  plugin: Pick<Plugin, "addCommand">,
  deps: QuickSwitchDeps,
): void {
  plugin.addCommand({
    id: "note-quick-switcher",
    name: m.command_open_lit_note_name(),
    callback: () => {
      openQuickSwitch(deps);
    },
  });
  plugin.addCommand({
    id: "switch-imported-note-profile",
    name: m.command_switch_imported_note_profile_name(),
    checkCallback: (checking) => {
      const file = deps.app.workspace.getActiveFile();
      if (
        !file ||
        noteKeyFromFrontmatter(deps.app.metadataCache.getFileCache(file)) ===
          null
      ) {
        return false;
      }
      if (!checking) void switchImportedNoteProfile(deps, file);
      return true;
    },
  });
}

export function openQuickSwitch(deps: QuickSwitchDeps): QuickSwitchModal {
  const modal = new QuickSwitchModal(deps);
  modal.open();
  return modal;
}
