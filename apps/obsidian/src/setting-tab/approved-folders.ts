// The Approved Attachment Roots sub-page: the one surface a folder outside
// Zotero's control is granted from, listed with the attachment import settings
// and marked as device state.

import type { SettingDefinitionItem, SettingDefinitionPage } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import { AttachmentImport } from "@/services/attachment-import/service";

import type { SettingsKey, SettingTabContext } from "./context";
import { appendDeviceOverrideNote, browseForDir } from "./device-override";

/**
 * The navigable entry the skip notice points at. Reachable with Attachment
 * Import switched off too, so a grant can always be reviewed and taken back.
 */
export function approvedFoldersPage(
  ctx: SettingTabContext,
): SettingDefinitionPage<SettingsKey> {
  return {
    type: "page",
    id: "settings_attachment_approved",
    name: m.settings_attachment_approved_name(),
    desc: approvedFoldersDesc(),
    items: approvedFolderItems(ctx),
  };
}

/** The entry's description, marked as Device Override state. */
function approvedFoldersDesc(): DocumentFragment {
  const desc = createFragment();
  desc.append(m.settings_attachment_approved_desc());
  appendDeviceOverrideNote(desc);
  return desc;
}

/** Static guidance shown above the mutable approved-folder list. */
function approvedFoldersPolicy(): SettingDefinitionItem<SettingsKey> {
  return {
    id: "settings_attachment_approved_policy",
    name: m.settings_attachment_approved_policy_name(),
    desc: m.settings_attachment_approved_policy_desc(),
  };
}

/**
 * The approved folders themselves, one row each. The sub-page's title already
 * names the list, so it carries no heading of its own.
 */
function approvedFolderItems(
  ctx: SettingTabContext,
): SettingDefinitionItem<SettingsKey>[] {
  const folders = ctx.tab.sync(
    AttachmentImport.use((service) => service.approvedFolders),
  );
  return [
    approvedFoldersPolicy(),
    {
      id: "settings_attachment_approved_list",
      type: "list",
      emptyState: m.settings_attachment_approved_empty(),
      addItem: {
        name: m.settings_attachment_approved_add(),
        action: () => pickApprovedFolder(ctx),
      },
      onDelete: (index) => {
        const folder = folders[index];
        if (folder === undefined) return;
        // The list follows the change through the tab's rebuild stream.
        void ctx.tab.run(
          AttachmentImport.use((service) => service.revokeFolder(folder)),
          m.settings_failed_revoke_folder(),
        );
      },
      items: folders.map((folder) => ({
        id: `settings_attachment_approved_entry:${folder}`,
        name: folder,
        searchable: false,
      })),
    },
  ];
}

/** Grant a folder through the explicit action — never as an import side effect. */
function pickApprovedFolder(ctx: SettingTabContext): void {
  void browseForDir({
    title: m.settings_attachment_approved_dialog_title(),
    startPath: undefined,
    onPick: (folder) => {
      void ctx.tab.run(
        AttachmentImport.use((service) => service.approveFolder(folder)),
        m.settings_failed_approve_folder(),
      );
    },
  });
}
