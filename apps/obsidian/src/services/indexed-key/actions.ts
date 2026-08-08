// Shared copy-key action used by Literature Notes, Annotation View, and Template Data Explorer.
import { TFile } from "obsidian";
import type { Plugin } from "obsidian";

import { formatIndexedKey } from "@zotlit/db";
import type { ParsedIndexedKey } from "@zotlit/db";

import * as m from "@/lib/i18n/generated/messages";
import * as toast from "@/lib/toast";
import { itemKeyFromFrontmatter } from "@/services/note-index/service";

export type IndexedKeyKind = "item" | "annotation";

/** The Indexed Key to copy, plus the kind that names it in the UI. */
export interface IndexedKeyCopyTarget {
  indexedKey: string;
  kind: IndexedKeyKind;
}

export function indexedKeyForClipboard(identity: ParsedIndexedKey): string {
  return formatIndexedKey(identity.key, identity.groupID);
}

export function copyIndexedKey(indexedKey: string): Promise<void> {
  const done = navigator.clipboard.writeText(indexedKey);
  void toast.promise(done, {
    success: m.indexed_key_copied(),
    error: m.indexed_key_copy_failed(),
  });
  return done;
}

export function addIndexedKeyActions(
  plugin: Pick<Plugin, "addCommand" | "app">,
): void {
  plugin.addCommand({
    id: "copy-item-key",
    name: m.command_copy_item_key_name(),
    checkCallback(checking) {
      const file = plugin.app.workspace.getActiveFile();
      if (!(file instanceof TFile)) return false;
      const indexedKey = itemKeyFromFrontmatter(
        plugin.app.metadataCache.getFileCache(file),
      );
      if (!indexedKey) return false;
      if (!checking) void copyIndexedKey(indexedKey);
      return true;
    },
  });
}
