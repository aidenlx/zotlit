import type { App, Plugin } from "obsidian";

import type { EffectBridge } from "@/lib/effect-bridge";
import * as m from "@/lib/i18n/generated/messages";
import type { LiteratureNoteAttachmentsHandle } from "@/services/attachment-open/handle";
import type { TargetOpener } from "@/services/attachment-open/open-target";
import type { ItemLookupHandle } from "@/services/item-lookup/handle";
import type { NoteFeature } from "@/services/note-feature";
import type { PlainNoteIndex } from "@/services/note-index/plain";
import type { PluginSettings } from "@/services/settings/service";
import type { PlainZoteroPref } from "@/services/zotero-pref/plain";
import type { ImportProfile, CreateProfile } from "@/setting-tab/profiles";

import { QuickSwitchModal } from "./modal";

export interface QuickSwitchDeps {
  createProfile: CreateProfile;
  importProfile: ImportProfile;
  app: App;
  /** Resolves the Attachments of the PDF a result asks for. */
  attachments: LiteratureNoteAttachmentsHandle;
  lookup: ItemLookupHandle;
  noteIndex: Pick<PlainNoteIndex, "whenIndexed" | "getNotesByItemKey">;
  noteFeature: Pick<NoteFeature, "createNote" | "planCreations">;
  settings: Pick<PluginSettings["Service"], "current">;
  bridge: Pick<EffectBridge, "runSync">;
  zoteroPref: Pick<PlainZoteroPref, "dataDir">;
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
