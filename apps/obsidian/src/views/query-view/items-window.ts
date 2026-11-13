// The window of an Items Layout over its entries: the group headings and
// Item rows of the Papers, Table and List layouts, of which a long list
// mounts only those near the screen (`virtual-rows.ts`). A layout gives its
// entries and draws the mounted ones; the window keeps the rows its host
// needs mounted (the selected row, the first row, the row under the focus),
// tells the host the order of the Item rows and how to scroll to one, and
// draws every entry for a print.
//
// @see apps/obsidian/docs/adr/0074-library-view-rows-act-as-quick-switcher-results.md
import { useCallback, useLayoutEffect, useMemo, useState } from "react";
import { useSyncExternalStore } from "react";

import { NO_ROWS } from "./item-rows";
import type { QueryView } from "./view";
import { useVirtualRows } from "./virtual-rows";
import type { VirtualRows } from "./virtual-rows";

/** One entry of an Items Layout, in the order it shows. */
export interface WindowEntry {
  /** A key of the entry that holds across runs. */
  readonly key: string;
  /**
   * What the entry is, such as a heading or a row of one line: an entry
   * takes the height its kind measures until it is measured itself.
   */
  readonly kind: string;
  /** The Indexed Key of the Item an Item row shows; `null` for a heading. */
  readonly item: string | null;
  /**
   * The entry takes a height of its own, as a row expanded into its
   * Attachments: its kind learns no height from it.
   */
  readonly own?: boolean;
}

/** What a layout draws through its window. */
export interface ItemsWindow extends VirtualRows {
  /** The ref of the layout's own box, which scrolls the list in a tab. */
  readonly box: (el: HTMLElement | null) => void;
}

/**
 * The window of `view`'s Items Layout over `entries`.
 * @param estimates The height of an entry of each kind before the list has
 *   measured entries of that kind; `fallback` for a kind it does not name.
 * @param shape What the entries' heights follow beside their content, such
 *   as the layout's options: a change measures them again.
 */
export function useItemsWindow(
  view: QueryView,
  entries: readonly WindowEntry[],
  {
    estimates,
    fallback,
    shape,
  }: {
    estimates: Readonly<Record<string, number>>;
    fallback: number;
    shape?: string;
  },
): ItemsWindow {
  const gestures = view.rows;
  const [own, setOwn] = useState<HTMLElement | null>(null);

  /** The Item rows in order, and the place of each Item's first row. */
  const { keys, places } = useMemo(() => {
    const keys: string[] = [];
    const places = new Map<string, number>();
    entries.forEach(({ item }, index) => {
      if (item === null) return;
      keys.push(item);
      if (!places.has(item)) places.set(item, index);
    });
    return { keys, places };
  }, [entries]);

  // The host's keys find the selected row, and the Tab stop is the first
  // row while none is selected: both stay mounted wherever they are.
  const selected = useSyncExternalStore(
    (listener) => gestures?.selection.subscribe(listener) ?? (() => {}),
    () => gestures?.selection.getState().key ?? null,
  );
  const first = gestures?.first() ?? null;
  const pinned = useMemo(
    () =>
      [selected, first].flatMap((key) =>
        key === null ? [] : [places.get(key) ?? -1],
      ),
    [selected, first, places],
  );

  const rows = useVirtualRows({
    count: entries.length,
    own,
    estimate: useCallback(
      (index: number) => estimates[entries[index]!.kind] ?? fallback,
      [entries, estimates, fallback],
    ),
    kindOf: useCallback(
      (index: number) => {
        const entry = entries[index]!;
        return entry.own ? null : entry.kind;
      },
      [entries],
    ),
    keyOf: useCallback((index: number) => entries[index]!.key, [entries]),
    pinned,
    ...(shape !== undefined && { shape }),
    all: view.printing,
  });

  const { scrollTo } = rows;
  useLayoutEffect(() => {
    gestures?.shown({
      keys,
      scrollTo: (key) => {
        const index = places.get(key);
        return index !== undefined && scrollTo(index);
      },
    });
    // A layout that goes shows no rows.
    return () => gestures?.shown(NO_ROWS);
  }, [gestures, keys, places, scrollTo]);

  return { ...rows, box: setOwn };
}
