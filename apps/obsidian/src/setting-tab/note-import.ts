// Declarative settings for the "Note import" sub-page.
import type { SettingDefinitionItem } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";

import type { SettingsControlKey, SettingTabContext } from "./context";
import { defaultProfileBindingPlaceholder } from "./placeholder";
import { profileControlKey } from "./profiles";

/** Items for the "Note import" sub-page. */
export function noteImportPageItems(
  _ctx: SettingTabContext,
): SettingDefinitionItem<SettingsControlKey>[] {
  return [
    {
      name: m.settings_note_import_folder_name(),
      desc: m.settings_note_import_folder_desc(),
      control: {
        type: "folder",
        key: profileControlKey("default", "import-folder"),
        placeholder: defaultProfileBindingPlaceholder("note.import-folder"),
      },
    },
    {
      name: m.settings_note_import_colored_highlights_name(),
      desc: m.settings_note_import_colored_highlights_desc(),
      control: {
        type: "toggle",
        key: profileControlKey("default", "colored-highlights"),
      },
    },
    {
      name: m.settings_note_import_annotations_template_name(),
      desc: m.settings_note_import_annotations_template_desc(),
      control: {
        type: "toggle",
        key: profileControlKey("default", "annotations-as-template"),
      },
    },
  ];
}
