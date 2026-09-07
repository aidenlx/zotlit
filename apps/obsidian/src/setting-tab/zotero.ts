// The "Zotero" page: how ZotLit talks to Zotero — connection, libraries, live
// updates, and the device-scoped overrides behind them.
import type { SettingDefinitionItem } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";

import type { SettingsKey, SettingTabContext } from "./context";
import { databaseAdvancedItems, databaseConnectionItems } from "./database";
import { libraryScopeRow, selectedLibrariesList } from "./library-scope";
import { liveUpdatesHostnameItem, liveUpdatesItems } from "./live-updates";

export function zoteroPageItems(
  ctx: SettingTabContext,
): SettingDefinitionItem<SettingsKey>[] {
  return [
    {
      type: "group",
      heading: m.settings_zotero_connection_heading(),
      items: databaseConnectionItems(ctx),
    },
    {
      type: "group",
      heading: m.settings_zotero_libraries_heading(),
      items: [libraryScopeRow(ctx)],
    },
    // A list cannot sit inside a group, so the selected Libraries follow the
    // Libraries group as their own compact section.
    selectedLibrariesList(ctx),
    {
      type: "group",
      heading: m.settings_page_live_updates(),
      items: liveUpdatesItems(ctx),
    },
    {
      type: "group",
      heading: m.settings_db_advanced(),
      items: [...databaseAdvancedItems(ctx), liveUpdatesHostnameItem(ctx)],
    },
  ];
}
