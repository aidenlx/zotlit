import { type ProtocolAction, type UpdateScope } from "@zotlit/protocol";

import { registerMenu } from "@/lib/l10n";
import { logger as appLogger } from "@/lib/logger";

import { copyObjectKeys } from "./copy-key.js";
import {
  exploreInObsidian,
  importInObsidian,
  importManyInObsidian,
  openInObsidian,
  updateManyInObsidian,
} from "./obsidian.js";

const logger = appLogger.getChild(["menus", "item"]);

const MENU_ID = "zotlit-item-menu";

type LibraryMenuContext = _ZoteroTypes.MenuManager.LibraryMenuContext;

function allItems(context: LibraryMenuContext): Zotero.Item[] {
  return context.items ?? [];
}

function regularItems(context: LibraryMenuContext): Zotero.Item[] {
  return allItems(context).filter((item) => item.isRegularItem());
}

function noteItems(context: LibraryMenuContext): Zotero.Item[] {
  return allItems(context).filter((item) => item.isNote());
}

function regularItemsWithChildNotes(
  context: LibraryMenuContext,
): Zotero.Item[] {
  return regularItems(context).filter((item) => item.getNotes().length > 0);
}

type SelectedObjectKind =
  | "attachment"
  | "childNote"
  | "item"
  | "mixed"
  | "note";

function kindOf(item: Zotero.Item): SelectedObjectKind {
  if (item.isAttachment()) return "attachment";
  // A standalone note is a top-level row, so it is not a Child Note.
  if (item.isNote()) return item.isTopLevelItem() ? "note" : "childNote";
  return "item";
}

/** The one kind every selected row shares, or `mixed`. */
function selectedKind(items: Zotero.Item[]): SelectedObjectKind {
  const kinds = new Set(items.map(kindOf));
  return kinds.size === 1 ? [...kinds][0]! : "mixed";
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
          context.setVisible(allItems(context).length >= 1);
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
              context.setVisible(
                regularItemsWithChildNotes(context).length >= 1,
              );
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
          {
            menuType: "menuitem",
            l10nID: "zotlit-menu-item-explore",
            onShowing(_event: Event, context: LibraryMenuContext): void {
              context.setVisible(regularItems(context).length === 1);
            },
            onCommand(_event: Event, context: LibraryMenuContext): void {
              const items = regularItems(context);
              if (items.length !== 1) return;
              exploreInObsidian(items[0]!);
            },
          },
          {
            menuType: "menuitem",
            l10nID: "zotlit-menu-item-copy-key",
            onShowing(_event: Event, context: LibraryMenuContext): void {
              const items = allItems(context);
              context.setVisible(items.length >= 1);
              context.setL10nArgs(
                JSON.stringify({
                  count: items.length,
                  kind: selectedKind(items),
                }),
              );
            },
            onCommand(_event: Event, context: LibraryMenuContext): void {
              const items = allItems(context);
              if (items.length === 0) return;
              copyObjectKeys(items);
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
