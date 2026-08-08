// Copy-key menu items and Literature Note file-menu registration.
import { TFile } from "obsidian";
import type { Menu, Plugin } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import { itemKeyFromFrontmatter } from "@/services/note-index/service";

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

export function registerIndexedKeyFileMenu(
  plugin: Pick<Plugin, "registerEvent" | "app">,
): void {
  plugin.registerEvent(
    plugin.app.workspace.on("file-menu", (menu, file, source) => {
      if (!(file instanceof TFile) || file.extension !== "md") return;
      if (source === "files-menu") return;
      const indexedKey = itemKeyFromFrontmatter(
        plugin.app.metadataCache.getFileCache(file),
      );
      if (!indexedKey) return;
      addCopyIndexedKeyMenuItem(
        menu,
        { indexedKey, kind: "item" },
        { section: "zotlit" },
      );
    }),
  );
}
