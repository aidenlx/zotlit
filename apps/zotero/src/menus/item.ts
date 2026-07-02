import { type ProtocolAction, type UpdateScope } from "@zotlit/protocol";

import { registerMenu } from "@/lib/l10n";
import { logger as appLogger } from "@/lib/logger";

import {
  importInObsidian,
  importManyInObsidian,
  openInObsidian,
  updateManyInObsidian,
} from "./obsidian.js";

const logger = appLogger.getChild(["menus", "item"]);

const MENU_ID = "zotlit-item-menu";

type LibraryMenuContext = _ZoteroTypes.MenuManager.LibraryMenuContext;

function regularItems(context: LibraryMenuContext): Zotero.Item[] {
  return (context.items ?? []).filter((item) => item.isRegularItem());
}

function noteItems(context: LibraryMenuContext): Zotero.Item[] {
  return (context.items ?? []).filter((item) => item.isNote());
}

function regularItemsWithChildNotes(
  context: LibraryMenuContext,
): Zotero.Item[] {
  return regularItems(context).filter((item) => item.getNotes().length > 0);
}

/**
 * `count` feeds the `$count` plural selector in the `update` label's Fluent
 * message. `setL10nArgs` needs a JSON string, not an object (see the type
 * augmentation in `types/zotero.d.ts`).
 */
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
        menuType: "submenu",
        l10nID: "zotlit-menu-submenu",
        onShowing(_event: Event, context: LibraryMenuContext): void {
          const hasRegular = regularItems(context).length >= 1;
          const hasNotes = noteItems(context).length >= 1;
          context.setVisible(hasRegular || hasNotes);
        },
        menus: [
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
          {
            menuType: "menuitem",
            l10nID: "zotlit-menu-item-import-child-notes",
            onShowing(_event: Event, context: LibraryMenuContext): void {
              const items = regularItemsWithChildNotes(context);
              context.setVisible(items.length >= 1);
              context.setL10nArgs(JSON.stringify({ count: items.length }));
            },
            onCommand(_event: Event, context: LibraryMenuContext): void {
              const items = regularItemsWithChildNotes(context);
              if (items.length === 0) return;
              if (items.length === 1) {
                importInObsidian(items[0]!.id, "child");
                return;
              }
              void importManyInObsidian(
                items.map((item) => item.id),
                "child",
              );
            },
          },
          {
            menuType: "menuitem",
            l10nID: "zotlit-menu-item-import-notes",
            onShowing(_event: Event, context: LibraryMenuContext): void {
              const items = noteItems(context);
              context.setVisible(items.length >= 1);
              context.setL10nArgs(JSON.stringify({ count: items.length }));
            },
            onCommand(_event: Event, context: LibraryMenuContext): void {
              const items = noteItems(context);
              if (items.length === 0) return;
              if (items.length === 1) {
                importInObsidian(items[0]!.id, "note");
                return;
              }
              void importManyInObsidian(
                items.map((item) => item.id),
                "note",
              );
            },
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
