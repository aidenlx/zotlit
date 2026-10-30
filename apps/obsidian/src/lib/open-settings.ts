// Deep links into the settings modal: select a tab, descend its sub-pages, and reveal one row.

import type {
  App,
  SettingDefinition,
  SettingDefinitionItem,
  SettingDefinitionPage,
} from "obsidian";

import { getLogger } from "@/lib/log";

const logger = getLogger("open-settings");

/**
 * A sub-page path: {@link SettingDefinitionPage#id} values, outermost first.
 *
 * Obsidian resolves each segment against a page's `id`, so a link survives a
 * reworded title and reads the same in every locale.
 */
export type SettingPagePath = readonly SettingDefinitionPage["id"][];

export function openSettingsTab(
  app: App,
  tabId: string,
  pagePath: SettingPagePath = [],
): void {
  app.setting.open();
  const tab = app.setting.openTabById(tabId);
  if (!tab || pagePath.length === 0) return;
  app.setting.navigateToSearchResult({ tab, pagePath: [...pagePath] });
}

/**
 * Open the settings modal on `tabId`, descend to the row `settingId` names, and
 * flash it the way a settings search hit does.
 *
 * A row is addressed by its definition object, so the definition is resolved
 * from the rendered tab on each call: every render hands out fresh objects.
 */
export function revealSetting(
  app: App,
  tabId: string,
  settingId: SettingDefinition["id"],
): void {
  app.setting.open();
  const tab = app.setting.openTabById(tabId);
  const hit = tab && locateSetting(tab.settingItems, settingId);
  if (!tab || !hit) {
    logger.debug("A deep link named no row this tab renders", {
      tabId,
      settingId,
    });
    return;
  }
  // The scroll reaches only the rendered page, so the sub-page opens first.
  app.setting.navigateToSearchResult({ tab, pagePath: hit.pagePath });
  app.setting.scrollToDefinition(tab, hit.definition);
}

/**
 * The first definition carrying `settingId`, with the sub-page path that
 * reaches it. Only a page names a step of the path; a group is stepped through.
 */
function locateSetting(
  items: SettingDefinitionItem[],
  settingId: SettingDefinition["id"],
  pagePath: string[] = [],
): { definition: SettingDefinition; pagePath: string[] } | null {
  for (const item of items) {
    if (!("type" in item)) {
      if (item.id === settingId) return { definition: item, pagePath };
      continue;
    }
    const nested = item.type === "page" ? [...pagePath, item.id] : pagePath;
    const hit = item.items && locateSetting(item.items, settingId, nested);
    if (hit) return hit;
  }
  return null;
}
