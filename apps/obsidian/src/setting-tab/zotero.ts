// The "Zotero" page: how ZotLit talks to Zotero, in the order a researcher
// meets it — the database, the libraries it reads, keeping it current, editing
// back, and search. Where Zotero lives on this device sits one page deeper.
import type { SettingDefinitionItem } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";

import { chineseSegmenterDefinition } from "./chinese-segmenter";
import type { SettingsKey, SettingTabContext } from "./context";
import {
  databaseFileItem,
  databaseLocationItems,
  databaseSyncItems,
} from "./database";
import { libraryScopeRow, selectedLibrariesList } from "./library-scope";
import { liveUpdatesItems } from "./local-server";
import { zoteroEditingRow } from "./zotero-editing";

export function zoteroPageItems(
  ctx: SettingTabContext,
): SettingDefinitionItem<SettingsKey>[] {
  return [
    // The general section leads without a heading: the database ZotLit reads,
    // and the way into its location when auto-detect gets it wrong.
    {
      type: "group",
      id: "settings_zotero_database",
      items: [
        databaseFileItem(ctx),
        {
          type: "page",
          id: "settings_page_zotero_location",
          name: m.settings_page_zotero_location(),
          desc: m.settings_page_zotero_location_desc(),
          items: databaseLocationItems(ctx),
        },
      ],
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
      id: "settings_zotero_sync",
      heading: m.settings_zotero_sync_heading(),
      items: databaseSyncItems(liveUpdatesItems(ctx)),
    },
    {
      type: "group",
      id: "settings_zotero_editing_group",
      heading: m.settings_zotero_editing_heading(),
      items: [zoteroEditingRow(ctx)],
    },
    {
      type: "group",
      id: "settings_zotero_search",
      heading: m.settings_zotero_search_heading(),
      items: [chineseSegmenterDefinition(ctx)],
    },
  ];
}
