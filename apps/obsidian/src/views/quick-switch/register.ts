import type { App, Plugin } from "obsidian";

import type { EffectBridge } from "@/lib/effect-bridge";
import * as m from "@/lib/i18n/generated/messages";
import type { LiteratureNoteAttachmentsHandle } from "@/services/attachment-open/handle";
import type { TargetOpener } from "@/services/attachment-open/open-target";
import type { ItemLookupHandle } from "@/services/item-lookup/handle";
import type { PluginSettings } from "@/services/settings/service";

import { QuickSwitchModal } from "./modal";
import type { NoteResultDeps } from "./result-actions";

export interface QuickSwitchDeps extends NoteResultDeps {
  app: App;
  /** Resolves the Attachments of the PDF a result asks for. */
  attachments: LiteratureNoteAttachmentsHandle;
  lookup: ItemLookupHandle;
  settings: Pick<PluginSettings["Service"], "current">;
  bridge: Pick<EffectBridge, "runSync">;
  /** Opens the PDF a result asks for. */
  opener: Pick<TargetOpener, "open">;
  /** Open the Library View with the Item selected. */
  showInLibrary: (indexedKey: string) => Promise<void>;
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
