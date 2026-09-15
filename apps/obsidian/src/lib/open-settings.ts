// Deep links into the settings modal: select a tab, descend its sub-pages, and reveal one row.

import { requireApiVersion } from "obsidian";
import type {
  App,
  SettingDefinition,
  SettingDefinitionItem,
  SettingDefinitionPage,
  SettingTab,
} from "obsidian";

/** A sub-page path: `SettingDefinitionPage#id` values, outermost first. */
export type SettingPagePath = readonly SettingDefinitionPage["id"][];

/**
 * Obsidian 1.14 resolves a `pagePath` segment against a page's `id` first and
 * its `name` second. Earlier builds read the `name` alone, so an id segment
 * never matches there.
 */
const PAGE_PATH_USES_ID = requireApiVersion("1.14.0");

/**
 * Open the settings modal on `tabId` and descend `pagePath`.
 *
 * `pagePath` holds {@link SettingDefinitionPage#id} values, outermost first,
 * so a link survives a reworded title and reads the same in every locale. On
 * obsidian builds that predate id matching, each id is resolved to the page's
 * `name` from the registered tab, since those builds read the name alone.
 */
export function openSettingsTab(
  app: App,
  tabId: string,
  pagePath: SettingPagePath = [],
): void {
  app.setting.open();
  const tab = app.setting.openTabById(tabId);
  if (!tab || pagePath.length === 0) return;
  app.setting.navigateToSearchResult({
    tab,
    pagePath: readablePagePath(tab, pagePath),
  });
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

/**
 * The path Obsidian reads: the ids themselves where it matches by id, else the
 * page names they name, so a build without id matching still descends. A page
 * the path cannot resolve is dropped, along with the rest of the path.
 */
function readablePagePath(
  tab: SettingTab,
  pagePath: SettingPagePath,
): string[] {
  if (PAGE_PATH_USES_ID) return [...pagePath];
  const resolved: string[] = [];
  let items: SettingDefinitionItem[] | undefined = tab.settingItems;
  for (const id of pagePath) {
    const page = findPage(items, id);
    if (!page) break;
    resolved.push(page.name);
    items = page.items;
  }
  return resolved;
}

/** The sub-page one id names among `items`, or undefined. */
function findPage(
  items: SettingDefinitionItem[] | undefined,
  id: string,
): SettingDefinitionPage | undefined {
  return items?.find(
    (item): item is SettingDefinitionPage =>
      "type" in item && item.type === "page" && item.id === id,
  );
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
