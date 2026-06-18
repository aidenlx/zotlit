import { type ProtocolAction } from "@zotlit/protocol";

import { registerMenu } from "@/lib/l10n";
import { logger as appLogger } from "@/lib/logger";

import { openInObsidian } from "./obsidian.js";

const logger = appLogger.getChild(["menus", "item"]);

const MENU_ID = "zotlit-item-menu";

type LibraryMenuContext = _ZoteroTypes.MenuManager.LibraryMenuContext;

function onCommand(action: ProtocolAction) {
  return (_event: Event, context: LibraryMenuContext): void => {
    const items = (context.items ?? []).filter((item) => item.isRegularItem());
    if (items.length === 0) {
      logger.debug("library-item menu invoked with no regular items", {
        action,
      });
      return;
    }
    for (const item of items) openInObsidian(action, item);
  };
}

export function registerItemMenu(pluginID: string): Disposable {
  logger.debug("registering library-item menu", { pluginID, menuID: MENU_ID });
  const menuID = registerMenu({
    menuID: MENU_ID,
    pluginID,
    target: "main/library/item",
    menus: [
      {
        menuType: "menuitem",
        l10nID: "zotlit-menu-item-open",
        onCommand: onCommand("open"),
      },
      {
        menuType: "menuitem",
        l10nID: "zotlit-menu-item-update",
        onCommand: onCommand("update"),
      },
    ],
  });
  if (menuID === false) {
    logger.error("MenuManager.registerMenu returned false", {
      menuID: MENU_ID,
      pluginID,
    });
    throw new Error("MenuManager.registerMenu failed for zotlit-item-menu");
  }
  logger.debug("registered library-item menu", { menuID });
  return {
    [Symbol.dispose]() {
      logger.debug("unregistering library-item menu", { menuID });
      Zotero.MenuManager.unregisterMenu(menuID);
    },
  };
}
