// Declarative settings for the "Note import" sub-page.
import type { SettingDefinitionItem } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";

import type { SettingsKey, SettingTabContext } from "./context";
import { defaultPlaceholder } from "./placeholder";

/** Items for the "Note import" sub-page. */
export function noteImportPageItems(
  _ctx: SettingTabContext,
): SettingDefinitionItem<SettingsKey>[] {
  return [
    {
      name: m.settings_note_import_folder_name(),
      desc: m.settings_note_import_folder_desc(),
      control: {
        type: "folder",
        key: "note.import-folder",
        placeholder: defaultPlaceholder("note.import-folder"),
      },
    },
    {
      name: m.settings_note_import_colored_highlights_name(),
      desc: m.settings_note_import_colored_highlights_desc(),
      control: {
        type: "toggle",
        key: "note.import-colored-highlights",
      },
    },
    {
      name: m.settings_note_import_annotations_template_name(),
      desc: m.settings_note_import_annotations_template_desc(),
      control: {
        type: "toggle",
        key: "note.import-annotations-as-template",
      },
    },
  ];
}
