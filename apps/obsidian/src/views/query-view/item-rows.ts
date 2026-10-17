// The gestures a host gives the Item rows of an Items Layout: the Library
// View selects a row with a click, and opens, lists the actions of, or drags
// the Item of a row. A Layout spreads `useItemRow` on each Item row; a host
// without gestures leaves the rows as they are.
//
// @see apps/obsidian/docs/adr/0073-library-view-rows-act-as-quick-switcher-results.md
import { useSyncExternalStore } from "react";
import type { DragEvent, HTMLAttributes, MouseEvent } from "react";
import type { StoreApi } from "zustand/vanilla";

/** What the host does on the gestures over one Item row. */
export interface ItemRowGestures {
  /** The Indexed Key of the selected row; `null` for none. */
  readonly selection: StoreApi<{ readonly key: string | null }>;
  /** A click on the row: select it. */
  select(key: string): void;
  /** A double click on the row, away from its links and buttons. */
  open(key: string, event: globalThis.MouseEvent): void;
  /** The row's context menu. */
  menu(key: string, event: globalThis.MouseEvent): void;
  /** The researcher starts to drag the row. */
  drag(key: string, event: DragEvent<HTMLElement>): void;
}

/** The attribute that holds an Item row's Indexed Key, for the host's keys. */
export const ITEM_ROW_ATTRIBUTE = "data-query-item-row";

/** Whether `event` landed on a link or a button inside the row. */
function onControl(event: { target: EventTarget; currentTarget: Element }) {
  const target = event.target as Node;
  if (!target.instanceOf(Element)) return false;
  const control = target.closest("a, button");
  return control !== null && event.currentTarget.contains(control);
}

/**
 * The attributes and handlers of the Item row `key`; none where the host
 * gives no gestures. The selected row is the one keyboard focus stops on.
 */
export function useItemRow(
  gestures: ItemRowGestures | undefined,
  key: string,
): HTMLAttributes<HTMLElement> & { "data-selected"?: "" } {
  const selected = useSyncExternalStore(
    (listener) => gestures?.selection.subscribe(listener) ?? (() => {}),
    () => gestures?.selection.getState().key === key,
  );
  if (!gestures) return {};
  return {
    [ITEM_ROW_ATTRIBUTE]: key,
    "data-selected": selected ? "" : undefined,
    tabIndex: selected ? 0 : -1,
    draggable: true,
    onClick: () => gestures.select(key),
    onDoubleClick: (event: MouseEvent<HTMLElement>) => {
      if (onControl(event)) return;
      gestures.open(key, event.nativeEvent);
    },
    onContextMenu: (event: MouseEvent<HTMLElement>) => {
      if (onControl(event)) return;
      event.preventDefault();
      gestures.select(key);
      gestures.menu(key, event.nativeEvent);
    },
    onDragStart: (event: DragEvent<HTMLElement>) => gestures.drag(key, event),
  } as HTMLAttributes<HTMLElement>;
}
