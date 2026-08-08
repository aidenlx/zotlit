// Deep links into the settings modal: select a tab, then descend its sub-pages.

import type { App } from "obsidian";

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
