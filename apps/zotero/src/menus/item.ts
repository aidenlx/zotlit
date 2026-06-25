import { type ProtocolAction, type UpdateScope } from "@zotlit/protocol";

import { registerMenu } from "@/lib/l10n";
import { logger as appLogger } from "@/lib/logger";

import { openInObsidian, updateManyInObsidian } from "./obsidian.js";

const logger = appLogger.getChild(["menus", "item"]);

const MENU_ID = "zotlit-item-menu";

type LibraryMenuContext = _ZoteroTypes.MenuManager.LibraryMenuContext;

function regularItems(context: LibraryMenuContext): Zotero.Item[] {
  return (context.items ?? []).filter((item) => item.isRegularItem());
}

/** `count` feeds the `$count` plural selector in the `update` label's Fluent
 *  message. `setL10nArgs` needs a JSON string, not an object (see the type
 *  augmentation in `types/zotero.d.ts`). */
function onShowing(action: ProtocolAction) {
  return (_event: Event, context: LibraryMenuContext): void => {
    const count = regularItems(context).length;
    if (action === "open") {
      context.setVisible(count === 1);
      return;
    }
    context.setVisible(count >= 1);
    context.setL10nArgs(JSON.stringify({ count }));
  };
}

function onCommand(action: ProtocolAction, scope?: UpdateScope) {
  return (_event: Event, context: LibraryMenuContext): void => {
    const items = regularItems(context);
    if (items.length === 0) {
      logger.debug("library-item menu invoked with no regular items", {
        action,
        scope,
      });
      return;
    }
    // Update routes a multi-selection through one batch action; open stays a
    // per-item loop.
    if (action === "update" && items.length > 1) {
      void updateManyInObsidian(items, scope);
      return;
    }
    for (const item of items) openInObsidian(action, item, scope);
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
        onShowing: onShowing("open"),
        onCommand: onCommand("open"),
      },
      {
        menuType: "menuitem",
        l10nID: "zotlit-menu-item-update",
        onShowing: onShowing("update"),
        onCommand: onCommand("update"),
      },
      {
        menuType: "menuitem",
        l10nID: "zotlit-menu-item-update-metadata",
        onShowing: onShowing("update"),
        onCommand: onCommand("update", "metadata"),
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
