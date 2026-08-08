// Collections-pane context menu for batch operations. Shown on library, group,
// and collection rows.
import { registerMenu } from "@/lib/l10n";
import type { TypedMenuOptions } from "@/lib/l10n";
import { logger as appLogger } from "@/lib/logger";
import type { FluentMessageId } from "@/types/fluent";

import { importAllNotesInObsidian, updateAllInObsidian } from "./obsidian.js";

const logger = appLogger.getChild(["menus", "collection"]);

const MENU_ID = "zotlit-collection-menu";

const MENU_TARGET = "main/library/collection";

type LibraryMenuContext = _ZoteroTypes.MenuManager.LibraryMenuContext;

type CollectionMenuData = TypedMenuOptions<typeof MENU_TARGET>["menus"][number];

/**
 * What a batch action covers: a whole library, or one collection within it.
 * `groupID` is `0` for the personal library and a positive integer for a group;
 * `collectionKey` is present on collection rows only.
 */
interface RowScope {
  groupID: number;
  collectionKey?: string;
}

/**
 * Scope of a collections-pane row, or `null` when the row names something the
 * batch actions can't cover — a saved search, feed, the trash, duplicates,
 * unfiled, retracted, or publications.
 *
 * `Zotero.Groups.getGroupIDFromLibraryID` throws for the personal library, so
 * the group id resolves off the row's library id only when it names a group.
 */
function rowScope(row: Zotero.CollectionTreeRow | undefined): RowScope | null {
  if (row?.isCollection()) {
    return {
      groupID: groupIDFromLibrary(row.ref.libraryID as number),
      collectionKey: row.ref.key as string,
    };
  }
  if (row?.isGroup()) {
    return { groupID: groupIDFromLibrary(row.ref.libraryID as number) };
  }
  return row?.isLibrary() ? { groupID: 0 } : null;
}

function groupIDFromLibrary(libraryID: number): number {
  if (libraryID === Zotero.Libraries.userLibraryID) return 0;
  return Zotero.Groups.getGroupIDFromLibraryID(libraryID);
}

/** One submenu entry, bound to the action it runs on the clicked row's scope. */
function scopedMenuItem(
  l10nID: FluentMessageId,
  run: (scope: RowScope) => void,
): CollectionMenuData {
  return {
    menuType: "menuitem",
    l10nID,
    onCommand(_event: Event, context: LibraryMenuContext): void {
      const scope = rowScope(
        context.collectionTreeRow as Zotero.CollectionTreeRow | undefined,
      );
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
          const row = context.collectionTreeRow as
            | Zotero.CollectionTreeRow
            | undefined;
          context.setVisible(rowScope(row) !== null);
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
