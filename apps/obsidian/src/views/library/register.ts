// The Library View as an Obsidian view: its tab type, the ribbon icon with
// the ZotLit mark, and the command that opens or focuses it. A tab open at
// quit comes back on startup, as Obsidian restores every registered view.
import { addIcon } from "obsidian";
import type { App, Plugin } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import { BaseNotice } from "@/lib/notice";

import { LIBRARY_VIEW_ROW_LIMIT } from "./document";
import { ZOTLIT_MARK_ICON, zotlitMarkSvg } from "./icon";
import { libraryItemCommand } from "./item-actions";
import { LIBRARY_VIEW_TYPE, LibraryView } from "./view";
import type { LibraryViewDeps } from "./view";

type LibraryViewPlugin = Pick<
  Plugin,
  "registerView" | "register" | "addCommand" | "addRibbonIcon" | "app"
>;

export function registerLibraryView(
  plugin: LibraryViewPlugin,
  deps: LibraryViewDeps,
): void {
  // Item gestures can outlive the Library tab that started them.
  plugin.register(deps.registry.mount(libraryItemCommand));
  addIcon(ZOTLIT_MARK_ICON, zotlitMarkSvg());
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
 * tab; the first screen (a first install, an update) takes the active leaf
 * only while it is empty, so it never replaces the note open there.
 */
export async function openLibraryView(
  app: App,
  { pane = "tab" }: { pane?: "tab" | "first-screen" } = {},
): Promise<LibraryView | null> {
  const { workspace } = app;
  let leaf = workspace.getLeavesOfType(LIBRARY_VIEW_TYPE)[0];
  if (!leaf) {
    const active =
      pane === "first-screen" ? workspace.getMostRecentLeaf() : null;
    leaf =
      active?.view.getViewType() === "empty"
        ? active
        : workspace.getLeaf("tab");
    await leaf.setViewState({ type: LIBRARY_VIEW_TYPE, active: true });
  } else {
    // Revealing a tab shows it but leaves the keyboard in the note.
    workspace.setActiveLeaf(leaf, { focus: true });
  }
  await workspace.revealLeaf(leaf);
  // A tab that the workspace restores on startup leaves the cursor where it
  // was.
  if (leaf.view instanceof LibraryView) leaf.view.arrive();
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
  const view = await openLibraryView(app);
  if ((await view?.reveal(indexedKey)) === "not-listed")
    new BaseNotice(
      m.library_view_reveal_not_listed({ limit: LIBRARY_VIEW_ROW_LIMIT }),
    );
}
