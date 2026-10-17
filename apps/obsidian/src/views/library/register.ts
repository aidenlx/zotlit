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
): Promise<LibraryView | null> {
  const { workspace } = app;
  let leaf = workspace.getLeavesOfType(LIBRARY_VIEW_TYPE)[0];
  if (!leaf) {
    leaf = workspace.getLeaf(pane);
    await leaf.setViewState({ type: LIBRARY_VIEW_TYPE, active: true });
  } else {
    // Revealing a tab shows it but leaves the keyboard in the note.
    workspace.setActiveLeaf(leaf, { focus: true });
  }
  await workspace.revealLeaf(leaf);
  // Search is the front door: the cursor waits in the box. A tab that the
  // workspace restores on startup leaves the cursor where it was.
  if (leaf.view instanceof LibraryView) leaf.view.search.focus();
  return leaf.view instanceof LibraryView ? leaf.view : null;
}

/**
 * Open the Library View on the Item `indexedKey`, selected in its first
 * Collection: the quick switcher's "Show in Library".
 */
export async function showInLibrary(
  app: App,
  indexedKey: string,
): Promise<void> {
  await (await openLibraryView(app))?.reveal(indexedKey);
}
