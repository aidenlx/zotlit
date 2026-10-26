// The gestures a host gives the Item rows of an Items Layout: the Library
// View selects a row with a click or as it takes the focus, and opens, lists
// the actions of, or drags the Item of a row. A Layout spreads `useItemRow` on each Item row; a host
// without gestures leaves the rows as they are.
//
// @see apps/obsidian/docs/adr/0074-library-view-rows-act-as-quick-switcher-results.md
import { useSyncExternalStore } from "react";
import type { DragEvent, FocusEvent, HTMLAttributes, MouseEvent } from "react";

/** What the host does on the gestures over one Item row. */
export interface ItemRowGestures {
  /** The Indexed Key of the selected row; `null` for none. */
  readonly selection: {
    getState(): { readonly key: string | null };
    getInitialState(): { readonly key: string | null };
    setState(
      state:
        | { readonly key: string | null }
        | Partial<{ readonly key: string | null }>
        | ((state: {
            readonly key: string | null;
          }) =>
            | { readonly key: string | null }
            | Partial<{ readonly key: string | null }>),
      replace?: boolean,
    ): void;
    subscribe(
      listener: (
        state: { readonly key: string | null },
        previous: { readonly key: string | null },
      ) => void,
    ): () => void;
  };
  /** The Indexed Key of the row the list shows first; `null` for none. */
  first(): string | null;
  /** A click on the row, away from its links and buttons. */
  // eslint-disable-next-line obsidianmd/no-global-this -- type position: React's event type shadows the DOM name
  click(key: string, event: globalThis.MouseEvent): void;
  /**
   * Select the row, and nothing more: the row itself takes the focus, as
   * from Tab, or a click lands on one of its links or buttons.
   */
  select(key: string): void;
  /** A double click on the row, away from its links and buttons. */
  // eslint-disable-next-line obsidianmd/no-global-this -- type position: React's event type shadows the DOM name
  open(key: string, event: globalThis.MouseEvent): void;
  /** The row's context menu, which acts on the row: the host selects it. */
  // eslint-disable-next-line obsidianmd/no-global-this -- type position: React's event type shadows the DOM name
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
 * gives no gestures. Keyboard focus stops on one row: the selected one, or
 * the first while none is selected. The selected row is the list's current
 * one to assistive technology: a row holds links and buttons, which an
 * option of a list box may not.
 */
export function useItemRow(
  gestures: ItemRowGestures | undefined,
  key: string,
): HTMLAttributes<HTMLElement> & { "data-selected"?: "" } {
  const selected = useSyncExternalStore(
    (listener) => gestures?.selection.subscribe(listener) ?? (() => {}),
    () => gestures?.selection.getState().key ?? null,
  );
  if (!gestures) return {};
  const stop = selected === null ? gestures.first() === key : selected === key;
  return {
    [ITEM_ROW_ATTRIBUTE]: key,
    "data-selected": selected === key ? "" : undefined,
    "aria-current": selected === key ? "true" : undefined,
    tabIndex: stop ? 0 : -1,
    draggable: true,
    onClick: (event: MouseEvent<HTMLElement>) => {
      if (onControl(event)) gestures.select(key);
      else gestures.click(key, event.nativeEvent);
    },
    onFocus: (event: FocusEvent<HTMLElement>) => {
      if (event.target === event.currentTarget) gestures.select(key);
    },
    onDoubleClick: (event: MouseEvent<HTMLElement>) => {
      if (onControl(event)) return;
      gestures.open(key, event.nativeEvent);
    },
    onContextMenu: (event: MouseEvent<HTMLElement>) => {
      if (onControl(event)) return;
      event.preventDefault();
      gestures.menu(key, event.nativeEvent);
    },
    onDragStart: (event: DragEvent<HTMLElement>) => gestures.drag(key, event),
  } as HTMLAttributes<HTMLElement>;
}
