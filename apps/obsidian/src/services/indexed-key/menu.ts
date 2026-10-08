// Copy-key menu items, and the copy-key entry on a Literature Note's file menu.
import type { Menu } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import { MENU_SECTION } from "@/lib/menu-section";
import type { FileMenuSegment } from "@/services/file-menu";

import { copyIndexedKey } from "./actions";
import type { IndexedKeyCopyTarget, IndexedKeyKind } from "./actions";

const COPY_LABEL: Record<IndexedKeyKind, () => string> = {
  item: m.command_copy_item_key_name,
  annotation: m.indexed_key_menu_copy_annotation,
};

/**
 * Add the copy-key entry for `target`, or nothing when there is no target.
 *
 * Pass `section` only where the host menu groups by section: Obsidian sorts
 * sectioned items ahead of unsectioned ones, so a section in a menu that has
 * none moves the entry away from the items it was inserted beside.
 */
export function addCopyIndexedKeyMenuItem(
  menu: Menu,
  target: IndexedKeyCopyTarget | null,
  options?: { section: string },
): boolean {
  if (!target) return false;
  menu.addItem((item) => {
    if (options) item.setSection(options.section);
    item
      .setTitle(COPY_LABEL[target.kind]())
      .setIcon("key-round")
      .onClick(() => {
        void copyIndexedKey(target.indexedKey);
      });
  });
  return true;
}

/** "Copy item key" on a Literature Note's file menu. */
export function indexedKeyFileMenu(): FileMenuSegment {
  return (menu, { itemKey }) => {
    addCopyIndexedKeyMenuItem(
      menu,
      itemKey ? { indexedKey: itemKey, kind: "item" } : null,
      { section: MENU_SECTION.info },
    );
  };
}
