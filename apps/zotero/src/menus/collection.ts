// Collections-pane context menu for batch operations. Shown on library, group,
// and collection rows.
import { registerMenu } from "@/lib/l10n";
import type { TypedMenuOptions } from "@/lib/l10n";
import { logger as appLogger } from "@/lib/logger";
import type { FluentMessageId } from "@/types/fluent";

import { contextScope } from "./collection-scope.js";
import type { RowScope } from "./collection-scope.js";
import { importAllNotesInObsidian, updateAllInObsidian } from "./obsidian.js";

const logger = appLogger.getChild(["menus", "collection"]);

const MENU_ID = "zotlit-collection-menu";

const MENU_TARGET = "main/library/collection";

type LibraryMenuContext = _ZoteroTypes.MenuManager.LibraryMenuContext;

type CollectionMenuData = TypedMenuOptions<typeof MENU_TARGET>["menus"][number];

/** One submenu entry, bound to the action it runs on the clicked row's scope. */
function scopedMenuItem(
  l10nID: FluentMessageId,
  run: (scope: RowScope) => void,
): CollectionMenuData {
  return {
    menuType: "menuitem",
    l10nID,
    onCommand(_event: Event, context: LibraryMenuContext): void {
      const scope = contextScope(context);
      if (!scope) return;
      run(scope);
    },
  };
}

export function registerCollectionMenu(pluginID: string): Disposable {
  logger.debug("registering collection menu", { pluginID, menuID: MENU_ID });
  const menuID = registerMenu({
    menuID: MENU_ID,
    pluginID,
    target: MENU_TARGET,
    menus: [
      {
        menuType: "submenu",
        l10nID: "zotlit-menu-submenu",
        onShowing(_event: Event, context: LibraryMenuContext): void {
          context.setVisible(contextScope(context) !== null);
        },
        menus: [
          scopedMenuItem("zotlit-menu-collection-update-all", (scope) => {
            updateAllInObsidian(scope.groupID, scope.collectionKey);
          }),
          scopedMenuItem("zotlit-menu-collection-import-all-notes", (scope) => {
            importAllNotesInObsidian(scope.groupID, scope.collectionKey);
          }),
        ],
      },
    ],
  });
  if (menuID === false) {
    logger.error("MenuManager.registerMenu returned false", {
      menuID: MENU_ID,
      pluginID,
    });
    throw new Error(
      "MenuManager.registerMenu failed for zotlit-collection-menu",
    );
  }
  logger.debug("registered collection menu", { menuID });
  return {
    [Symbol.dispose]() {
      logger.debug("unregistering collection menu", { menuID });
      Zotero.MenuManager.unregisterMenu(menuID);
    },
  };
}
