// The Item drag of a Library View row: dropped into a note, it inserts the
// Item's citation where it lands. It is the Item payload next to the
// Annotation drag's own (`application/x-zotlit-annotation`); outside a note
// it carries the Item's `zotero://select` link as text.
//
// @see apps/obsidian/docs/adr/0074-library-view-rows-act-as-quick-switcher-results.md
import { nanoid } from "nanoid";
import type { App } from "obsidian";
import type { DragEvent } from "react";

import { itemSelectUri, parseIndexedKey } from "@zotlit/db";

import type { ItemActions } from "./item-actions";

/** The drag data type of an Item; its value names one drag. */
export const ITEM_DRAG_TYPE = "application/x-zotlit-item";

export interface ItemDragDeps {
  app: Pick<App, "workspace">;
  actions: Pick<ItemActions, "insertCitation">;
}

/** Start the drag of the row that lists `indexedKey`. */
export function createItemDrag(deps: ItemDragDeps) {
  let active: (() => void) | null = null;
  const drag = (indexedKey: string, event: DragEvent<HTMLElement>): void => {
    active?.();
    const request = nanoid();
    const parsed = parseIndexedKey(indexedKey);
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(
      "text/plain",
      parsed ? itemSelectUri(parsed.key, parsed.groupID) : indexedKey,
    );
    event.dataTransfer.setData(ITEM_DRAG_TYPE, request);

    const { workspace } = deps.app;
    const win = event.currentTarget.win;
    const cleanup = () => {
      workspace.offref(dropRef);
      win.removeEventListener("dragend", cleanup);
      if (active === cleanup) active = null;
    };
    // eslint-disable-next-line obsidianmd/editor-drop-paste
    const dropRef = workspace.on("editor-drop", (dropEvent, editor, info) => {
      if (dropEvent.dataTransfer?.getData(ITEM_DRAG_TYPE) !== request) return;
      dropEvent.preventDefault();
      cleanup();
      // The nearest position, as CodeMirror's own drop handler asks for: the
      // exact form is null over an empty active line.
      const at = editor.cm.posAtCoords(
        { x: dropEvent.clientX, y: dropEvent.clientY },
        false,
      );
      deps.actions.insertCitation(indexedKey, { editor, info, at });
    });
    active = cleanup;
    win.addEventListener("dragend", cleanup, { once: true });
  };
  return Object.assign(drag, { cancel: () => active?.() });
}

/**
 * Refuse an Item dropped back on the Library View, so the pointer shows
 * that it lands nowhere.
 */
// eslint-disable-next-line obsidianmd/no-global-this -- type position: React's event type shadows the DOM name
export function refuseItemDrop(event: globalThis.DragEvent): void {
  if (!event.dataTransfer?.types.includes(ITEM_DRAG_TYPE)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "none";
}
