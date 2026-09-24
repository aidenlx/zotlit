// The Annotation History entries in a bound PDF view's More options menu.
import type { Plugin, WorkspaceLeaf } from "obsidian";

import {
  HISTORY_DIRECTIONS,
  historyCommandName,
  historyStands,
} from "./actions";
import type { HistorySurface } from "./actions";
import type { HistoryDirection } from "./history";
import type { AnnotationRepository } from "./service";

/** Obsidian's own undo and redo glyphs, so the rows read as the app's do. */
const ICONS: Readonly<Record<HistoryDirection, string>> = {
  undo: "undo-2",
  redo: "redo-2",
};

export interface AnnotationHistoryMenuDeps {
  annotations: Pick<AnnotationRepository, "canRedo" | "canUndo">;
  /**
   * The Annotation History surface a leaf holds, or `null` where it holds
   * none — a PDF view bound to a Zotero Attachment, and nothing else.
   */
  surfaceFor: (leaf: WorkspaceLeaf) => HistorySurface | null;
}

/**
 * Register the Annotation History entries on a bound PDF view's More options
 * menu. `FileView.onPaneMenu` raises that menu as the workspace's own
 * `file-menu` event, so the entries go in beside every other one rather than
 * through a patch of Obsidian's view.
 *
 * Obsidian builds the menu each time it opens, so what each entry can do is
 * read there and then; this surface follows no event. A direction with nothing
 * to step is shown disabled rather than dropped, so the menu says what the
 * history can do instead of changing shape under the pointer. A PDF that is
 * not a Zotero Attachment carries no entries at all.
 */
export function registerAnnotationHistoryFileMenu(
  plugin: Pick<Plugin, "registerEvent" | "app">,
  deps: AnnotationHistoryMenuDeps,
): void {
  plugin.registerEvent(
    // oxlint-disable-next-line max-params -- Obsidian's own `file-menu` shape.
    plugin.app.workspace.on("file-menu", (menu, _file, source, leaf) => {
      if (source !== "more-options" || !leaf) return;
      const surface = deps.surfaceFor(leaf);
      const attachmentKey = surface?.historyAttachment;
      if (!surface || !attachmentKey) return;

      for (const direction of HISTORY_DIRECTIONS) {
        menu.addItem((item) =>
          item
            .setSection("zotlit")
            .setTitle(historyCommandName(direction))
            .setIcon(ICONS[direction])
            .setDisabled(
              !historyStands(deps.annotations, attachmentKey, direction),
            )
            .onClick(() => surface.stepHistory(direction)),
        );
      }
    }),
  );
}
