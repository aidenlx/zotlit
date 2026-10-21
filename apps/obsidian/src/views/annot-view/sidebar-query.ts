// The sidebar Annotation View as a Query View: the Query File it runs, and
// the Sort, Group by and "Filter..." rows of its More options menu. The file
// is the sidebar's whole view state, so "Save as query file" can write it.
//
// @see apps/obsidian/docs/adr/0069-the-annotation-view-is-the-annotations-layout-of-the-query-view.md
import type { Menu } from "obsidian";

import { annotationColorsForName, annotationColorToName } from "@zotlit/db";
import type { MatchTree } from "@zotlit/templates/facade";

import * as m from "@/lib/i18n/generated/messages";
import { visibleText } from "@/services/item-query/visible-text";
import {
  directionLabel,
  groupOptions,
  sortOptions,
} from "@/views/query-view/properties";
import type { PropertyOption } from "@/views/query-view/properties";
import { serializeQueryFile, withFilters } from "@/views/query-view/query-file";
import type {
  QueryFile,
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
  /** Opens "Save as query file"; `undefined` while the sidebar follows no Item. */
  saveAs?: () => void;
}

/**
 * Sort, Group by and "Filter..." in the More options menu. Sort and Group by
 * open submenus; "Filter..." opens the Match editor.
 */
export function addSidebarQueryMenu(
  menu: Menu,
  { view, edit, openFilter, saveAs }: SidebarQueryMenuInput,
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
  if (saveAs)
    menu.addItem((item) =>
      item
        .setTitle(m.annot_view_save_as_query_file())
        .setIcon("file-plus")
        .onClick(saveAs),
    );
}

/**
 * Which records a saved Query File shows: those of the Attachment (or the
 * Item) the sidebar follows, or those of the Item of the note that embeds it.
 */
export type SavedRecords = "this-item" | "note-item";

/** The colour, tag and search filter of the sidebar's filter bar. */
export interface SidebarFilterBar {
  /** The search text; "" for none. */
  readonly query: string;
  /** The colours as uppercase `#RRGGBB`. */
  readonly colors: readonly string[];
  readonly tags: readonly string[];
}

export interface SaveQueryFileInput {
  readonly file: QueryFile;
  /** The view the sidebar shows. */
  readonly view: QueryFileView;
  readonly filter: SidebarFilterBar;
  readonly records: SavedRecords;
  /** The followed Item's Indexed Key. */
  readonly itemKey: string | null;
  /** The followed Attachment's Indexed Key. */
  readonly attachmentKey: string | null;
}

/**
 * One colour swatch as a condition: its name where the name is of this
 * colour alone, else its hex code.
 */
function colorCondition(color: string): string {
  const name = annotationColorToName(color);
  if (name && annotationColorsForName(name).length === 1)
    return `colorName == ${JSON.stringify(name)}`;
  return `color.lower() == ${JSON.stringify(color.toLowerCase())}`;
}

/**
 * The search text as a condition: the same text in the visible text of the
 * highlighted text or the comment, a tag or the page label, in any case.
 */
function searchCondition(query: string): string {
  const needle = JSON.stringify(query.toLowerCase());
  return [
    `${visibleText("text")}.lower().contains(${needle})`,
    `${visibleText("comment")}.lower().contains(${needle})`,
    `!tags.filter(value.lower().contains(${needle})).isEmpty()`,
    `pageLabel.lower().contains(${needle})`,
  ].join(" || ");
}

/** The filter bar's conditions; each one must hold. */
function filterBarConditions({
  query,
  colors,
  tags,
}: SidebarFilterBar): MatchTree[] {
  const conditions: MatchTree[] = [];
  if (colors.length === 1) conditions.push(colorCondition(colors[0]!));
  else if (colors.length > 1)
    conditions.push({ or: colors.map(colorCondition) });
  if (tags.length > 0)
    conditions.push(
      `tags.containsAny(${tags.map((tag) => JSON.stringify(tag)).join(", ")})`,
    );
  if (query !== "") conditions.push(searchCondition(query));
  return conditions;
}

/** `tree` and `more`, all of which must hold. */
function allOf(
  tree: MatchTree | undefined,
  more: readonly MatchTree[],
): MatchTree | undefined {
  if (more.length === 0) return tree;
  if (tree === undefined)
    return more.length === 1 ? more[0] : { and: [...more] };
  const head = typeof tree !== "string" && "and" in tree ? tree.and : [tree];
  return { and: [...head, ...more] };
}

/**
 * The text of a Query File that shows what the sidebar shows: its view, with
 * the filter bar added to the view's filters, and the filters for all views
 * set to the records the researcher chose.
 */
export function savedQueryFileText({
  file,
  view,
  filter,
  records,
  itemKey,
  attachmentKey,
}: SaveQueryFileInput): string {
  const scope =
    records === "note-item"
      ? "item == this.item"
      : attachmentKey !== null
        ? `attachment.indexedKey == ${JSON.stringify(attachmentKey)}`
        : `item.indexedKey == ${JSON.stringify(itemKey ?? "")}`;
  const one = withFilters(
    { ...file, views: [view] },
    0,
    allOf(view.filters, filterBarConditions(filter)),
  );
  return serializeQueryFile(withFilters(one, null, scope));
}
