// The Cited By Sidebar's sort menu.
import { Menu } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import { showMenuAtButton } from "@/lib/menu";

import { CITED_BY_SORT_GROUPS } from "./store";
import type { CitedBySortMode } from "./store";

const SORT_LABELS: Record<CitedBySortMode, () => string> = {
  alphabetical: m.cited_by_sort_alphabetical,
  alphabeticalReverse: m.cited_by_sort_alphabetical_reverse,
  byModifiedTime: m.cited_by_sort_modified_time,
  byModifiedTimeReverse: m.cited_by_sort_modified_time_reverse,
  byCreatedTime: m.cited_by_sort_created_time,
  byCreatedTimeReverse: m.cited_by_sort_created_time_reverse,
};

/**
 * The sort menu, one section per Backlinks mode pair, anchored under the button
 * that opened it.
 */
export function showSortMenu(
  button: HTMLElement,
  options: {
    readonly current: CitedBySortMode;
    readonly select: (mode: CitedBySortMode) => void;
  },
): void {
  const menu = new Menu().setNoIcon();
  for (const pair of CITED_BY_SORT_GROUPS) {
    for (const mode of pair) {
      menu.addItem((item) =>
        item
          .setTitle(SORT_LABELS[mode]())
          .setChecked(mode === options.current)
          .onClick(() => options.select(mode)),
      );
    }
    menu.addSeparator();
  }

  showMenuAtButton(menu, button);
}
