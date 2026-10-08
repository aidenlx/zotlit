// ZotLit's one entry into Obsidian's file menu.
//
// Obsidian raises `file-menu` for the file explorer's context menu, a tab
// header, a file view's "More options", a link's context menu, and more. Every
// ZotLit entry there comes through the single listener below, from segments
// named in one ordered list, so where an entry sits is decided in one place:
// its section (`@/lib/menu-section`) picks the group, and the list's order
// picks its row inside that group.
import { TFile } from "obsidian";
import type { Menu, Plugin, WorkspaceLeaf } from "obsidian";

import {
  itemKeyFromFrontmatter,
  noteKeyFromFrontmatter,
} from "@/services/note-index/parse";

/** What every segment reads, resolved once each time the menu opens. */
export interface FileMenuContext {
  file: TFile;
  /**
   * Obsidian's name for the surface that raised the menu, such as
   * `file-explorer-context-menu`, `more-options`, `tab-header`, or
   * `link-context-menu`.
   */
  source: string;
  /** The leaf whose view raised the menu; only a view's own menus carry one. */
  leaf: WorkspaceLeaf | undefined;
  /** The Zotero Item a Literature Note is about, or `null` for any other file. */
  itemKey: string | null;
  /** The Zotero note a Note Import is of, or `null` for any other file. */
  noteKey: string | null;
}

/**
 * Adds a feature's entries for `ctx`, or nothing where they do not apply.
 * Runs synchronously, as Obsidian builds the menu in one tick; only an entry's
 * `onClick` may await.
 */
export type FileMenuSegment = (menu: Menu, ctx: FileMenuContext) => void;

/**
 * Register `segments` on Obsidian's file menu, in the order given. A
 * segment's entries keep that order inside their section.
 */
export function registerFileMenu(
  plugin: Pick<Plugin, "registerEvent" | "app">,
  segments: readonly FileMenuSegment[],
): void {
  const { app } = plugin;
  plugin.registerEvent(
    // oxlint-disable-next-line max-params -- Obsidian's own `file-menu` shape.
    app.workspace.on("file-menu", (menu, file, source, leaf) => {
      if (!(file instanceof TFile)) return;
      const cache =
        file.extension === "md" ? app.metadataCache.getFileCache(file) : null;
      const ctx: FileMenuContext = {
        file,
        source,
        leaf,
        itemKey: itemKeyFromFrontmatter(cache),
        noteKey: noteKeyFromFrontmatter(cache),
      };
      for (const segment of segments) segment(menu, ctx);
    }),
  );
}
