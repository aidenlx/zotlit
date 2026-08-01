// Items for the "Attachments" sub-page: whether an attachment is imported,
// where in the vault it lands, and which external source folders are approved.

import { type SettingDefinitionItem } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";

import { approvedFoldersPage } from "./approved-folders";
import { type SettingsKey, type SettingTabContext } from "./context";

export function attachmentPageItems(
  ctx: SettingTabContext,
): SettingDefinitionItem<SettingsKey>[] {
  return [
    {
      name: m.settings_attachment_import_name(),
      desc: m.settings_attachment_import_desc(),
      control: { type: "toggle", key: "attachment.import" },
    },
    {
      name: m.settings_attachment_folder_name(),
      desc: m.settings_attachment_folder_desc(),
      visible: () => ctx.settings.current?.["attachment.import"] ?? true,
      // Empty value falls back to Obsidian's default attachment folder.
      control: {
        type: "folder",
        key: "attachment.folder-path",
        defaultValue: "",
      },
    },
    approvedFoldersPage(ctx),
  ];
}
