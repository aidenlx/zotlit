import { type App, type Plugin } from "obsidian";

import * as m from "@/paraglide/messages";
import { type ItemLookup } from "@/services/item-lookup/service";
import { type NoteIndex } from "@/services/note-index/service";
import { type SettingsService } from "@/services/settings/service";

import { QuickSwitchModal } from "./modal";

export interface QuickSwitchDeps {
  app: App;
  lookup: ItemLookup;
  noteIndex: NoteIndex;
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
}

export function openQuickSwitch(deps: QuickSwitchDeps): QuickSwitchModal {
  const modal = new QuickSwitchModal(deps);
  modal.open();
  return modal;
}
