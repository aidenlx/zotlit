// The sidebar Annotation View as a Query View: the Query File it runs, and
// the Sort, Group by and "Filter..." rows of its More options menu. The file
// is the sidebar's whole view state, so "Save as query file" can write it.
//
// @see apps/obsidian/docs/adr/0069-the-annotation-view-is-the-annotations-layout-of-the-query-view.md
import type { Menu } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import {
  directionLabel,
  groupOptions,
  sortOptions,
} from "@/views/query-view/properties";
import type { PropertyOption } from "@/views/query-view/properties";
import { serializeQueryFile } from "@/views/query-view/query-file";
import type {
  QueryFileDirection,
  QueryFileSort,
  QueryFileView,
  QueryFileViewEdit,
} from "@/views/query-view/query-file";

/** The filter for all views of the sidebar: the Attachment it follows. */
export const SIDEBAR_FILTER = "attachment == this.attachment";

/** The Query File a fresh sidebar runs: every Annotation of the followed Attachment. */
export function sidebarQueryText(): string {
  return serializeQueryFile({
    filters: SIDEBAR_FILTER,
    views: [
      {
        type: "annotations",
        name: m.annot_view_name(),
        from: "annotations",
        problems: [],
        source: {},
      },
    ],
    problems: [],
    source: {},
  });
}

/**
 * The properties the sidebar sorts by: those of the Annotation itself. The
 * Item and the Attachment are the same for every card it shows.
 */
export function sidebarSortOptions(): PropertyOption[] {
  return sortOptions("annotations").filter(
    (option) => !option.path.includes("."),
  );
}

/** The properties the sidebar groups by: colour and tag. */
export function sidebarGroupOptions(): PropertyOption[] {
  return groupOptions("annotations").filter(
    (option) => option.path === "colorName" || option.path === "tags[]",
  );
}

/** Where the cards stand when the view names no sort: their place in the document. */
const DEFAULT_SORT: QueryFileSort = { property: "sortIndex", direction: "ASC" };

export interface SidebarQueryMenuInput {
  /** The view the sidebar shows; `null` while it shows none. */
  view: QueryFileView | null;
  edit: (edit: QueryFileViewEdit) => void;
  openFilter: () => void;
}

/**
 * Sort, Group by and "Filter..." in the More options menu. Sort and Group by
 * open submenus; "Filter..." opens the Match editor.
 */
export function addSidebarQueryMenu(
  menu: Menu,
  { view, edit, openFilter }: SidebarQueryMenuInput,
): void {
  if (!view) return;
  const sorts = sidebarSortOptions();
  const sort = view.sort?.[0] ?? DEFAULT_SORT;
  const sortKind =
    sorts.find((option) => option.path === sort.property)?.kind ?? "text";
  menu.addItem((item) => {
    item.setTitle(m.annot_view_sort()).setIcon("arrow-up-down");
    const sub = item.setSubmenu();
    for (const option of sorts)
      sub.addItem((row) =>
        row
          .setTitle(option.label)
          .setChecked(option.path === sort.property)
          .onClick(() =>
            edit({
              sort: [{ property: option.path, direction: sort.direction }],
            }),
          ),
      );
    sub.addSeparator();
    for (const direction of ["ASC", "DESC"] as QueryFileDirection[])
      sub.addItem((row) =>
        row
          .setTitle(directionLabel(sortKind, direction))
          .setChecked(direction === sort.direction)
          .onClick(() =>
            edit({ sort: [{ property: sort.property, direction }] }),
          ),
      );
  });
  menu.addItem((item) => {
    item.setTitle(m.annot_view_group_by()).setIcon("layout-list");
    const sub = item.setSubmenu();
    sub.addItem((row) =>
      row
        .setTitle(m.annot_view_group_by_none())
        .setChecked(view.groupBy === undefined)
        .onClick(() => edit({ groupBy: undefined })),
    );
    for (const option of sidebarGroupOptions())
      sub.addItem((row) =>
        row
          .setTitle(option.label)
          .setChecked(view.groupBy?.property === option.path)
          .onClick(() =>
            edit({ groupBy: { property: option.path, direction: "ASC" } }),
          ),
      );
  });
  menu.addItem((item) =>
    item
      .setTitle(m.annot_view_filter())
      .setIcon("list-filter")
      .onClick(openFilter),
  );
}
