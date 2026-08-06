// Deep links into the settings modal: select a tab, descend its sub-pages, and reveal one row.

import {
  type App,
  type SettingDefinition,
  type SettingDefinitionItem,
} from "obsidian";

/**
 * Open the settings modal on `tabId` and descend `pagePath`.
 *
 * `pagePath` holds `SettingDefinitionPage` names, outermost first. Pass the
 * same message getters the definitions use, so the path stays correct in
 * every locale.
 */
export function openSettingsTab(
  app: App,
  tabId: string,
  pagePath: string[] = [],
): void {
  app.setting.open();
  const tab = app.setting.openTabById(tabId);
  if (!tab || pagePath.length === 0) return;
  app.setting.navigateToSearchResult({ tab, pagePath });
}

/**
 * Open the settings modal on `tabId`, descend to the row named `name`, and
 * flash it the way a settings search hit does.
 *
 * A row is addressed by its definition object, so the definition is resolved
 * from the rendered tab on each call: every render hands out fresh objects.
 * Pass the same message getter the definition uses, so the name matches in
 * every locale.
 */
export function revealSetting(app: App, tabId: string, name: string): void {
  app.setting.open();
  const tab = app.setting.openTabById(tabId);
  const hit = tab && locateSetting(tab.settingItems, name);
  if (!tab || !hit) return;
  // The scroll reaches only the rendered page, so the sub-page opens first.
  app.setting.navigateToSearchResult({ tab, pagePath: hit.pagePath });
  app.setting.scrollToDefinition(tab, hit.definition);
}

/** The first definition named `name`, with the sub-page path that reaches it. */
function locateSetting(
  items: SettingDefinitionItem[],
  name: string,
  pagePath: string[] = [],
): { definition: SettingDefinition; pagePath: string[] } | null {
  for (const item of items) {
    if (!("type" in item)) {
      if (item.name === name) return { definition: item, pagePath };
      continue;
    }
    const nested = item.type === "page" ? [...pagePath, item.name] : pagePath;
    const hit = item.items && locateSetting(item.items, name, nested);
    if (hit) return hit;
  }
  return null;
}
