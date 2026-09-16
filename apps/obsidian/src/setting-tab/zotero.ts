// The "Zotero" page: how ZotLit talks to Zotero — connection, libraries, and
// the device-scoped overrides behind them.
import type { SettingDefinitionItem } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";

import type { SettingsKey, SettingTabContext } from "./context";
import { databaseAdvancedItems, databaseConnectionItems } from "./database";
import { libraryScopeRow, selectedLibrariesList } from "./library-scope";
import { zoteroEditingRow } from "./zotero-editing";

export function zoteroPageItems(
  ctx: SettingTabContext,
): SettingDefinitionItem<SettingsKey>[] {
  return [
    {
      type: "group",
      id: "settings_zotero_connection",
      heading: m.settings_zotero_connection_heading(),
      items: [...databaseConnectionItems(ctx), zoteroEditingRow(ctx)],
    },
    {
      type: "group",
      id: "settings_zotero_libraries",
      heading: m.settings_zotero_libraries_heading(),
      items: [libraryScopeRow(ctx)],
    },
    // A list cannot sit inside a group, so the selected Libraries follow the
    // Libraries group as their own compact section.
    selectedLibrariesList(ctx),
    {
      type: "group",
      id: "settings_db_advanced",
      heading: m.settings_db_advanced(),
      items: databaseAdvancedItems(ctx),
    },
  ];
}
