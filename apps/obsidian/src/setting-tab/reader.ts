// Items for the "Reader" sub-page: what ZotLit does around Obsidian's own PDF
// reader once it puts a Zotero Attachment there.

import type { SettingDefinitionItem } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";

import type { SettingsKey } from "./context";

export function readerPageItems(): SettingDefinitionItem<SettingsKey>[] {
  return [
    {
      id: "settings_reader_focus_annot_view",
      name: m.settings_reader_focus_annot_view_name(),
      desc: m.settings_reader_focus_annot_view_desc(),
      control: { type: "toggle", key: "reader.focus-annot-view" },
    },
  ];
}
