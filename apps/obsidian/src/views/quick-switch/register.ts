import type { App, Plugin } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import type { TargetOpener } from "@/services/attachment-open/open-target";
import type { ItemLookup } from "@/services/item-lookup/service";
import type { NoteFeature } from "@/services/note-feature";
import type { PlainNoteIndex } from "@/services/note-index/plain";
import type { SettingsService } from "@/services/settings/service";
import type { PlainZoteroPref } from "@/services/zotero-pref/plain";
import type { ZoteroReadsService } from "@/services/zotero-reads/service";
import type { ImportProfile, CreateProfile } from "@/setting-tab/profiles";

import { QuickSwitchModal } from "./modal";

export interface QuickSwitchDeps {
  createProfile: CreateProfile;
  importProfile: ImportProfile;
  app: App;
  reads: Pick<ZoteroReadsService, "acquireRead">;
  lookup: ItemLookup;
  noteIndex: Pick<PlainNoteIndex, "whenIndexed" | "getNotesByItemKey">;
  noteFeature: Pick<NoteFeature, "createNote" | "planCreations">;
  settings: SettingsService;
  zoteroPref: Pick<PlainZoteroPref, "dataDir" | "baseAttachmentPath">;
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
