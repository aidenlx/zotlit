// The Library View as an Obsidian view: its tab type, the ribbon icon with
// the ZotLit mark, and the command that opens or focuses it. A tab open at
// quit comes back on startup, as Obsidian restores every registered view.
import { addIcon } from "obsidian";
import type { App, Plugin } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";

import { ZOTLIT_MARK_ICON, ZOTLIT_MARK_SVG } from "./icon";
import { LIBRARY_VIEW_TYPE, LibraryView } from "./view";
import type { LibraryViewDeps } from "./view";

type LibraryViewPlugin = Pick<
  Plugin,
  "registerView" | "addCommand" | "addRibbonIcon" | "app"
>;

export function registerLibraryView(
  plugin: LibraryViewPlugin,
  deps: LibraryViewDeps,
): void {
  addIcon(ZOTLIT_MARK_ICON, ZOTLIT_MARK_SVG);
  plugin.registerView(LIBRARY_VIEW_TYPE, (leaf) => new LibraryView(leaf, deps));
  const open = () => void openLibraryView(plugin.app);
  plugin.addCommand({
    id: "open-library-view",
    name: m.command_open_library_view_name(),
    callback: open,
  });
  plugin.addRibbonIcon(
    ZOTLIT_MARK_ICON,
    m.command_open_library_view_name(),
    open,
  );
}

/**
 * Bring the Library View forward. Where no tab holds it, it opens in a new
 * tab, or in the active one for `pane: false`, as on a first install.
 */
export async function openLibraryView(
  app: App,
  { pane = "tab" }: { pane?: "tab" | false } = {},
): Promise<void> {
  const { workspace } = app;
  let leaf = workspace.getLeavesOfType(LIBRARY_VIEW_TYPE)[0];
  if (!leaf) {
    leaf = workspace.getLeaf(pane);
    await leaf.setViewState({ type: LIBRARY_VIEW_TYPE, active: true });
  }
  await workspace.revealLeaf(leaf);
}
