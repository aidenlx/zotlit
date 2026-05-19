import { registerMenu } from "@/lib/l10n.js";
import { logger as appLogger } from "@/lib/logger.js";

const logger = appLogger.getChild(["menus", "item"]);

const MENU_ID = "zotlit-item-menu";

type ItemAction = "open" | "update" | "export";

function onCommand(action: ItemAction) {
  return (): void => {
    logger.info("library-item menu invoked", { action });
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
        menuType: "submenu",
        l10nID: "zotlit-menu-item-submenu",
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
          {
            menuType: "menuitem",
            l10nID: "zotlit-menu-item-export",
            onCommand: onCommand("export"),
          },
        ],
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
