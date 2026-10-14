// The properties a Query View's Sort and Group controls offer, by the names a
// researcher knows them by. Sort offers only Sortable Fields of ZotLit Query;
// Group offers the group paths the layouts of the view's dataset can gather
// rows by.
import { ANNOTATIONS, ATTACHMENTS, ITEMS } from "@zotlit/item-query";

import * as m from "@/lib/i18n/generated/messages";

import type { QueryFileDataset, QueryFileDirection } from "./query-file";
import type { ItemGroupPath, LayoutGroupPath } from "./rows";

/** How a property's values order, which names its two directions. */
export type PropertyKind = "text" | "date" | "number";

export interface PropertyOption {
  /** The Projection Path, as the file names it. */
  readonly path: string;
  readonly label: string;
  readonly kind: PropertyKind;
}

const ANNOTATION_SORT_CANDIDATES: readonly [
  string,
  () => string,
  PropertyKind,
][] = [
  ["sortIndex", m.query_view_property_position, "number"],
  ["pageIndex", m.query_view_property_page, "number"],
  ["dateAdded", m.query_view_property_date_added, "date"],
  ["dateModified", m.query_view_property_date_modified, "date"],
  ["color", m.query_view_property_color, "text"],
  ["type", m.query_view_property_type, "text"],
  ["item.title", m.query_view_property_item_title, "text"],
  ["item.firstAuthor", m.query_view_property_first_author, "text"],
  ["item.date", m.query_view_property_item_date, "date"],
  ["item.dateModified", m.query_view_property_item_date_modified, "date"],
  ["attachment.title", m.query_view_property_attachment_title, "text"],
  ["attachment.dateAdded", m.query_view_property_attachment_date_added, "date"],
];

const ITEM_SORT_CANDIDATES: readonly [string, () => string, PropertyKind][] = [
  ["title", m.query_view_property_title, "text"],
  ["firstAuthor", m.query_view_property_first_author, "text"],
  ["date", m.query_view_property_date, "date"],
  ["dateAdded", m.query_view_property_date_added, "date"],
  ["dateModified", m.query_view_property_date_modified, "date"],
  ["itemType", m.query_view_property_item_type, "text"],
];

const ATTACHMENT_SORT_CANDIDATES: readonly [
  string,
  () => string,
  PropertyKind,
][] = [
  ["title", m.query_view_property_title, "text"],
  ["dateAdded", m.query_view_property_date_added, "date"],
  ["dateModified", m.query_view_property_date_modified, "date"],
  ["item.title", m.query_view_property_item_title, "text"],
  ["item.firstAuthor", m.query_view_property_first_author, "text"],
  ["item.date", m.query_view_property_item_date, "date"],
];

/** The properties a view of `dataset` can sort by, in the order Sort lists them. */
export function sortOptions(
  dataset: QueryFileDataset | undefined,
): PropertyOption[] {
  const [candidates, fields] =
    dataset === "items"
      ? [ITEM_SORT_CANDIDATES, ITEMS.sortableFields]
      : dataset === "attachments"
        ? [ATTACHMENT_SORT_CANDIDATES, ATTACHMENTS.sortableFields]
        : [ANNOTATION_SORT_CANDIDATES, ANNOTATIONS.sortableFields];
  const sortable = new Set(fields);
  return candidates
    .filter(([path]) => sortable.has(path))
    .map(([path, label, kind]) => ({ path, label: label(), kind }));
}

/** The properties a view of `dataset` can group by, in the order Group lists them. */
export function groupOptions(
  dataset: QueryFileDataset | undefined,
): PropertyOption[] {
  const options: [LayoutGroupPath | ItemGroupPath, () => string][] =
    dataset === "items"
      ? [
          ["itemType", m.query_view_property_item_type],
          ["tags[]", m.query_view_property_tag],
          ["collections[]", m.query_view_property_collection],
        ]
      : dataset === "attachments"
        ? [
            ["item.indexedKey", m.query_view_property_item],
            ["tags[]", m.query_view_property_tag],
            ["item.collections[]", m.query_view_property_collection],
          ]
        : [
            ["item.indexedKey", m.query_view_property_item],
            ["attachment.indexedKey", m.query_view_property_attachment],
            ["colorName", m.query_view_property_color],
            ["tags[]", m.query_view_property_tag],
            ["item.collections[]", m.query_view_property_collection],
          ];
  return options.map(([path, label]) => ({
    path,
    label: label(),
    kind: "text",
  }));
}

/** The name of one direction of a property, as Bases names it. */
export function directionLabel(
  kind: PropertyKind,
  direction: QueryFileDirection,
): string {
  const ascending = direction === "ASC";
  switch (kind) {
    case "date":
      return ascending
        ? m.query_view_sort_old_new()
        : m.query_view_sort_new_old();
    case "number":
      return ascending ? m.query_view_sort_01() : m.query_view_sort_10();
    case "text":
      return ascending ? m.query_view_sort_az() : m.query_view_sort_za();
    default:
      kind satisfies never;
      return direction;
  }
}
